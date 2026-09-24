import "server-only";
import type { Store } from "@/lib/store/types";
import type { AkahuClient, AkahuTransaction } from "@/lib/akahu/types";
import type { SyncLog, Transaction } from "@/lib/types";
import { addDays, addMonths, todayLocal, toLocalDate } from "@/lib/dates";
import { buildMerchantMemory, categorise, pairTransfers } from "@/lib/categorise";
import { linkTotals, removeLinksFor } from "@/lib/reimburse";
import { reverseIouForLink } from "@/lib/iou";
import { generateSuggestions } from "@/lib/suggest";
import { fromCents, toCents } from "@/lib/money";

export const BACKFILL_MONTHS = 12;
export const OVERLAP_DAYS = 7; // re-fetch recent days to catch late-settling items
/** Refuse to flag more than this share of a window as "removed by bank" in one go. */
const MAX_REMOVED_SHARE = 0.2;

type TxnRow = Omit<Transaction, "id" | "user_id" | "created_at" | "updated_at">;

/** Mock ids can't collide with real Akahu ids (those are prefix + cuid, no underscores). */
export const isMockAccountId = (id: string) => id.startsWith("acc_mock_");
export const isMockTxnId = (id: string | null) => Boolean(id?.startsWith("trans_mock_"));

function validate(t: AkahuTransaction): string | null {
  if (!t._id || !t._account) return "missing id/account";
  if (!Number.isFinite(t.amount)) return "invalid amount";
  if (!t.date || Number.isNaN(Date.parse(t.date))) return "invalid date";
  return null;
}

/**
 * Incremental Akahu sync. Safety rules:
 *  - Everything is fetched from Akahu first; nothing is written until every
 *    page has arrived and validated, so a failed/partial fetch changes nothing.
 *  - Writes are upserts keyed on Akahu ids (idempotent); existing rows are
 *    never deleted. Transactions the bank removes are flagged (removed_at) and
 *    excluded from totals; accounts that disappear get missing_since.
 *  - Manual categorisation is never overwritten.
 *  - Mock rows are purged only after a successful *live* fetch, and only rows
 *    whose ids carry the mock prefix.
 */
export async function runSync(
  store: Store,
  client: AkahuClient,
  trigger: SyncLog["trigger"],
  opts: { full?: boolean } = {},
): Promise<SyncLog> {
  const [log] = await store.insert("sync_log", [
    {
      started_at: new Date().toISOString(),
      finished_at: null,
      status: "running",
      trigger,
      mode: client.mode,
      range_start: null,
      range_end: null,
      accounts_synced: 0,
      transactions_upserted: 0,
      transactions_new: 0,
      pending_count: 0,
      error: null,
      warnings: null,
    },
  ]);
  const finish = async (patch: Partial<SyncLog>) => {
    const done = { ...log, ...patch, finished_at: new Date().toISOString() };
    await store.update("sync_log", { eq: { id: log.id } }, done);
    return done;
  };
  const warnings: string[] = [];

  try {
    // ---------------------------------------------------------- 1. fetch
    const today = todayLocal();
    const existingAccounts = await store.select("accounts");
    const [latest] = await store.select(
      "transactions",
      { eq: { is_manual: false } },
      { order: { column: "local_date", ascending: false }, limit: 1 },
    );
    const freshStart = client.mode === "live" && latest && isMockTxnId(latest.akahu_id);
    const start =
      !opts.full && latest && !freshStart ? addDays(latest.local_date, -OVERLAP_DAYS) : addMonths(today, -BACKFILL_MONTHS);
    // Pad by a day each side so NZ/UTC boundaries never drop a transaction.
    const startIso = `${addDays(start, -1)}T00:00:00.000Z`;
    const endIso = new Date().toISOString();

    const akAccounts = await client.listAccounts();
    const akTxns = await client.listTransactions(startIso, endIso);
    const pending = await client.listPendingTransactions();
    const bad = akTxns.map((t) => [t, validate(t)] as const).filter(([, why]) => why);
    if (bad.length) throw new Error(`Akahu returned ${bad.length} malformed transaction(s), e.g. ${bad[0][1]}; nothing was changed`);
    const seenAccounts = new Set(akAccounts.map((a) => a._id));
    const orphan = akTxns.find((t) => !seenAccounts.has(t._account));
    if (orphan) throw new Error(`Akahu returned a transaction for an unknown account (${orphan._account}); nothing was changed`);

    // ---------------------------------------------------------- 2. write
    if (client.mode === "live") {
      const purged = await purgeMockData(store);
      if (purged) warnings.push(`Removed ${purged} mock transactions before the first live sync`);
    }

    const now = new Date().toISOString();
    const accounts = await store.upsert(
      "accounts",
      akAccounts.map((a) => ({
        id: a._id,
        name: a.name,
        institution: a.connection?.name ?? "Unknown",
        type: a.type,
        formatted_account: a.formatted_account ?? null,
        balance_current: a.balance?.current ?? null,
        balance_available: a.balance?.available ?? null,
        currency: a.balance?.currency ?? "NZD",
        status: a.status,
        missing_since: null,
      })),
      "id",
    );
    // Accounts Akahu no longer returns: keep them and their history, just flag.
    const gone = existingAccounts.filter((a) => !seenAccounts.has(a.id) && !a.missing_since && !(client.mode === "live" && isMockAccountId(a.id)));
    if (gone.length) {
      await store.update("accounts", { in: { id: gone.map((a) => a.id) } }, { missing_since: now });
      warnings.push(`${gone.length} account(s) no longer returned by Akahu: ${gone.map((a) => a.name).join(", ")}`);
    }

    // Categorise
    const ids = akTxns.map((t) => t._id);
    const existing = ids.length ? await store.select("transactions", { in: { akahu_id: ids } }) : [];
    const existingById = new Map(existing.map((t) => [t.akahu_id!, t]));
    const [categories, rules, remembered] = await Promise.all([
      store.select("categories"),
      store.select("rules"),
      store.select("transactions", { in: { category_source: ["manual", "rule"] } }),
    ]);
    const ctx = { categories, rules, accounts, merchantMemory: buildMerchantMemory(remembered) };

    let newCount = 0;
    const rows: TxnRow[] = akTxns.map((t: AkahuTransaction) => {
      const prev = existingById.get(t._id);
      if (!prev) newCount++;
      const conv = t.meta?.conversion;
      const base = {
        akahu_id: t._id,
        account_id: t._account,
        date: t.date,
        local_date: toLocalDate(t.date),
        description: t.description,
        merchant_name: t.merchant?.name ?? null,
        amount: fromCents(toCents(t.amount)),
        type: t.type ?? null,
        akahu_category: t.category?.name ?? null,
        is_manual: false,
        notes: prev?.notes ?? null,
        foreign_amount: conv && Number.isFinite(conv.amount) ? Math.abs(conv.amount) : null,
        foreign_currency: conv?.currency ? String(conv.currency).toUpperCase().slice(0, 3) : null,
        removed_at: null, // returned again → not removed
      };
      // Keep any existing decision (manual, rule, or otherwise) once made.
      if (prev && prev.category_id) {
        return { ...base, category_id: prev.category_id, category_source: prev.category_source, is_transfer: prev.is_transfer };
      }
      const decided = categorise(
        { ...base, akahu_group: t.category?.groups?.personal_finance?.name ?? null, other_account: t.meta?.other_account ?? null },
        ctx,
      );
      return { ...base, ...decided };
    });
    const saved = await store.upsert("transactions", rows, "akahu_id");

    // Settled transactions the bank has since removed: flag, never delete.
    const fetchedIds = new Set(ids);
    const window = (await store.select("transactions", { gte: { local_date: addDays(start, 1) }, eq: { is_manual: false } })).filter(
      (t) =>
        t.akahu_id &&
        t.account_id &&
        seenAccounts.has(t.account_id) &&
        !t.removed_at &&
        // compare like with like: live rows against a live fetch, mock against mock
        isMockTxnId(t.akahu_id) === (client.mode === "mock"),
    );
    const missing = window.filter((t) => !fetchedIds.has(t.akahu_id!) && t.local_date <= addDays(today, -1));
    if (missing.length) {
      if (akTxns.length === 0 || missing.length > Math.max(3, window.length * MAX_REMOVED_SHARE)) {
        warnings.push(`Akahu didn't return ${missing.length} previously synced transactions; not flagging them (looks like an incomplete response)`);
      } else {
        await store.update("transactions", { in: { id: missing.map((t) => t.id) } }, { removed_at: now });
        warnings.push(`${missing.length} transaction(s) were removed by the bank and are now excluded from totals`);
      }
    }

    // Amounts Akahu edited may leave links over-allocated: trim them.
    const trimmed = await reconcileLinks(store);
    if (trimmed) warnings.push(`${trimmed} net-off link(s) removed because the bank changed an amount`);

    // Pair transfers between my own accounts (both legs -> Transfers).
    const transfersCat = categories.find((c) => c.kind === "transfer" && !c.parent_id);
    const pairable = new Set(
      saved.filter((t) => !t.is_transfer && (t.category_source === null || t.category_source === "akahu" || t.category_source === "merchant")).map((t) => t.id),
    );
    const pairIds = [...pairTransfers(saved)].filter((id) => pairable.has(id));
    if (pairIds.length && transfersCat) {
      await store.update(
        "transactions",
        { in: { id: pairIds } },
        { category_id: transfersCat.id, category_source: "transfer", is_transfer: true },
      );
    }

    // Pending: replace wholesale (settled versions arrive with an _id). The
    // new set was fetched above, so a failure can't leave us with none.
    await store.remove("pending_transactions", {});
    const knownAccounts = new Set(accounts.map((a) => a.id));
    const pend = pending.filter((p) => knownAccounts.has(p._account) && Number.isFinite(p.amount));
    if (pend.length) {
      await store.insert(
        "pending_transactions",
        pend.map((p) => ({
          account_id: p._account,
          date: p.date,
          local_date: toLocalDate(p.date),
          description: p.description,
          amount: fromCents(toCents(p.amount)),
          type: p.type ?? null,
        })),
      );
    }

    // Suggest net offs for new incoming money (never applied automatically).
    try {
      const since = start > addDays(today, -30) ? start : addDays(today, -30);
      await generateSuggestions(store, { since });
    } catch (err) {
      warnings.push(`Couldn't compute net-off suggestions: ${err instanceof Error ? err.message : err}`);
    }

    return await finish({
      status: "success",
      range_start: start,
      range_end: today,
      accounts_synced: accounts.length,
      transactions_upserted: saved.length,
      transactions_new: newCount,
      pending_count: pend.length,
      warnings: warnings.length ? warnings.join(" · ") : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] failed:", message);
    return await finish({ status: "error", error: message, warnings: warnings.length ? warnings.join(" · ") : null });
  }
}

/** Delete newest links first until no transaction is over-allocated. */
export async function reconcileLinks(store: Store): Promise<number> {
  const links = await store.select("reimbursement_links", undefined, { order: { column: "created_at", ascending: false } });
  if (!links.length) return 0;
  const txns = await store.select("transactions", { in: { id: [...new Set(links.flatMap((l) => [l.expense_id, l.income_id]))] } });
  const byId = new Map(txns.map((t) => [t.id, t]));
  let current = [...links];
  let removed = 0;
  for (const l of links) {
    const totals = linkTotals(current);
    const e = byId.get(l.expense_id);
    const i = byId.get(l.income_id);
    const eBad = !e || toCents(e.amount) >= 0 || (totals.toExpense.get(e.id) ?? 0) > -toCents(e.amount);
    const iBad = !i || toCents(i.amount) <= 0 || (totals.fromIncome.get(i.id) ?? 0) > toCents(i.amount);
    if (eBad || iBad) {
      await reverseIouForLink(store, l);
      await store.remove("reimbursement_links", { eq: { id: l.id } });
      current = current.filter((x) => x.id !== l.id);
      removed++;
    }
  }
  return removed;
}

/**
 * Remove mock accounts/transactions. Only ids with the mock prefixes match
 * (acc_mock_… / trans_mock_…); manual/cash rows and real Akahu rows are
 * untouched. Links/IOUs/suggestions/trip overrides on purged rows go too.
 */
export async function purgeMockData(store: Store): Promise<number> {
  const mockAccounts = (await store.select("accounts")).map((a) => a.id).filter(isMockAccountId);
  if (!mockAccounts.length) return 0;
  const mockTxnIds = (await store.select("transactions", { in: { account_id: mockAccounts } }))
    .filter((t) => !t.is_manual && isMockTxnId(t.akahu_id))
    .map((t) => t.id);
  await store.remove("pending_transactions", { in: { account_id: mockAccounts } });
  await removeLinksFor(store, mockTxnIds);
  const n = mockTxnIds.length ? await store.remove("transactions", { in: { id: mockTxnIds } }) : 0;
  await store.remove("accounts", { in: { id: mockAccounts } });
  console.log(`[sync] purged ${n} mock transactions before first live sync`);
  return n;
}

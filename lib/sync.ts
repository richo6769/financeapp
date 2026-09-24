import "server-only";
import type { Store } from "@/lib/store/types";
import type { AkahuClient, AkahuTransaction } from "@/lib/akahu/types";
import type { SyncLog, Transaction } from "@/lib/types";
import { addDays, addMonths, todayLocal, toLocalDate } from "@/lib/dates";
import { buildMerchantMemory, categorise, pairTransfers } from "@/lib/categorise";

export const BACKFILL_MONTHS = 12;
export const OVERLAP_DAYS = 7; // re-fetch recent days to catch late-settling items

type TxnRow = Omit<Transaction, "id" | "user_id" | "created_at" | "updated_at">;

/**
 * Incremental Akahu sync:
 *  1. upsert accounts
 *  2. fetch settled transactions since (latest synced date - overlap), or 12
 *     months on first run; upsert on Akahu _id so re-runs never duplicate
 *  3. categorise new/uncategorised rows (manual choices are never touched)
 *  4. pair internal transfers across my accounts
 *  5. replace the pending set wholesale
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
    },
  ]);
  const finish = async (patch: Partial<SyncLog>) => {
    const done = { ...log, ...patch, finished_at: new Date().toISOString() };
    await store.update("sync_log", { eq: { id: log.id } }, done);
    return done;
  };

  try {
    // 0. First live sync after testing in mock mode: drop the fake data.
    if (client.mode === "live") await purgeMockData(store);

    // 1. Accounts
    const akAccounts = await client.listAccounts();
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
      })),
      "id",
    );

    // 2. Range
    const today = todayLocal();
    const [latest] = await store.select(
      "transactions",
      { eq: { is_manual: false } },
      { order: { column: "local_date", ascending: false }, limit: 1 },
    );
    const start =
      !opts.full && latest ? addDays(latest.local_date, -OVERLAP_DAYS) : addMonths(today, -BACKFILL_MONTHS);
    // Pad by a day each side so NZ/UTC boundaries never drop a transaction.
    const startIso = `${addDays(start, -1)}T00:00:00.000Z`;
    const endIso = new Date().toISOString();
    const akTxns = await client.listTransactions(startIso, endIso);

    // 3. Categorise
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
      const base = {
        akahu_id: t._id,
        account_id: t._account,
        date: t.date,
        local_date: toLocalDate(t.date),
        description: t.description,
        merchant_name: t.merchant?.name ?? null,
        amount: t.amount,
        type: t.type ?? null,
        akahu_category: t.category?.name ?? null,
        is_manual: false,
        notes: prev?.notes ?? null,
      };
      // Keep any existing decision (manual, rule, or otherwise) once made.
      if (prev && prev.category_id) {
        return {
          ...base,
          category_id: prev.category_id,
          category_source: prev.category_source,
          is_transfer: prev.is_transfer,
        };
      }
      const decided = categorise(
        {
          ...base,
          akahu_group: t.category?.groups?.personal_finance?.name ?? null,
          other_account: t.meta?.other_account ?? null,
        },
        ctx,
      );
      return { ...base, ...decided };
    });
    const saved = await store.upsert("transactions", rows, "akahu_id");

    // 4. Pair transfers between my own accounts (both legs -> Transfers).
    const transfersCat = categories.find((c) => c.kind === "transfer" && !c.parent_id);
    const pairable = saved.filter((t) => !t.is_transfer && (t.category_source === null || t.category_source === "akahu" || t.category_source === "merchant"));
    const pairIds = [...pairTransfers(saved)].filter((id) => pairable.some((t) => t.id === id));
    if (pairIds.length && transfersCat) {
      await store.update(
        "transactions",
        { in: { id: pairIds } },
        { category_id: transfersCat.id, category_source: "transfer", is_transfer: true },
      );
    }

    // 5. Pending: replace wholesale (settled versions arrive with an _id).
    const pending = await client.listPendingTransactions();
    await store.remove("pending_transactions", {});
    if (pending.length) {
      await store.insert(
        "pending_transactions",
        pending.map((p) => ({
          account_id: p._account,
          date: p.date,
          local_date: toLocalDate(p.date),
          description: p.description,
          amount: p.amount,
          type: p.type ?? null,
        })),
      );
    }

    return await finish({
      status: "success",
      range_start: start,
      range_end: today,
      accounts_synced: accounts.length,
      transactions_upserted: saved.length,
      transactions_new: newCount,
      pending_count: pending.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] failed:", message);
    return await finish({ status: "error", error: message });
  }
}

/** Remove mock accounts/transactions (ids prefixed acc_mock_ / trans_mock_). */
export async function purgeMockData(store: Store): Promise<number> {
  const mockAccounts = (await store.select("accounts")).filter((a) => a.id.startsWith("acc_mock_")).map((a) => a.id);
  if (!mockAccounts.length) return 0;
  await store.remove("pending_transactions", { in: { account_id: mockAccounts } });
  const n = await store.remove("transactions", { in: { account_id: mockAccounts } });
  await store.remove("accounts", { in: { id: mockAccounts } });
  console.log(`[sync] purged ${n} mock transactions before first live sync`);
  return n;
}

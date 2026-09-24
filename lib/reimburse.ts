import "server-only";
import type { Filter, Store } from "@/lib/store/types";
import type { ReimbursementLink, Transaction } from "@/lib/types";
import { addDays, todayLocal } from "@/lib/dates";
import { formatCents, fromCents, toCents, type Cents } from "@/lib/money";
import { applyLinkToIou, reverseIouForLink } from "@/lib/iou";
import { normalise } from "@/lib/categorise";
import { UserError } from "@/lib/errors";
import { clip } from "@/lib/text";

/**
 * "Net off": link incoming money (credits) to the expenses it reimburses.
 *  - An expense counts at its NET amount: |amount| − linked reimbursements.
 *  - The linked part of an incoming payment is excluded from income (and
 *    from spend, if it was categorised as an expense), so nothing is counted
 *    twice. Any unallocated remainder still counts per its category.
 */

export interface LinkTotals {
  /** expense id -> total reimbursed, in cents (positive) */
  toExpense: Map<string, Cents>;
  /** incoming id -> total allocated, in cents (positive) */
  fromIncome: Map<string, Cents>;
}

export function linkTotals(links: ReimbursementLink[]): LinkTotals {
  const toExpense = new Map<string, number>();
  const fromIncome = new Map<string, number>();
  for (const l of links) {
    toExpense.set(l.expense_id, (toExpense.get(l.expense_id) ?? 0) + toCents(l.amount));
    fromIncome.set(l.income_id, (fromIncome.get(l.income_id) ?? 0) + toCents(l.amount));
  }
  return { toExpense, fromIncome };
}

export async function loadLinkTotals(store: Store): Promise<LinkTotals> {
  return linkTotals(await store.select("reimbursement_links"));
}

/** Signed amount after netting, in cents: debits move toward 0, credits lose allocations. */
export function netCents(t: Pick<Transaction, "id" | "amount">, totals: LinkTotals): Cents {
  const c = toCents(t.amount);
  if (c < 0) return c + (totals.toExpense.get(t.id) ?? 0);
  if (c > 0) return c - (totals.fromIncome.get(t.id) ?? 0);
  return 0;
}

export function netAmount(t: Pick<Transaction, "id" | "amount">, totals: LinkTotals): number {
  return fromCents(netCents(t, totals));
}

/** Replace `amount` with the net amount (keeps the original as gross_amount). */
export function applyNet<T extends Transaction>(txns: T[], totals: LinkTotals): (T & { gross_amount: number })[] {
  if (!totals.toExpense.size && !totals.fromIncome.size) return txns.map((t) => ({ ...t, gross_amount: t.amount }));
  return txns.map((t) => ({ ...t, gross_amount: t.amount, amount: netAmount(t, totals) }));
}

/** What's left to link: for an expense, unreimbursed; for a credit, unallocated. */
export function remainingCents(t: Pick<Transaction, "id" | "amount">, totals: LinkTotals): Cents {
  return Math.abs(netCents(t, totals));
}

export function remainingOf(t: Pick<Transaction, "id" | "amount">, totals: LinkTotals): number {
  return fromCents(remainingCents(t, totals));
}

const label = (t: Transaction) => t.merchant_name ?? t.description;

export async function linkReimbursement(
  store: Store,
  input: { expense_id: string; income_id: string; amount?: number; iou_id?: string | null },
): Promise<{
  link: ReimbursementLink;
  amount: number;
  expense: { id: string; name: string; gross: number; net: number };
  income: { id: string; name: string; amount: number; unallocated: number };
}> {
  if (input.expense_id === input.income_id) throw new UserError("Pick two different transactions");
  const [[expense], [income]] = await Promise.all([
    store.select("transactions", { eq: { id: input.expense_id } }),
    store.select("transactions", { eq: { id: input.income_id } }),
  ]);
  if (!expense) throw new UserError("Expense not found");
  if (!income) throw new UserError("Incoming payment not found");
  if (expense.amount >= 0) throw new UserError("Only an expense (money out) can be netted off");
  if (income.amount <= 0) throw new UserError("Only incoming money can be linked to an expense");

  if (expense.removed_at || income.removed_at) throw new UserError("That transaction was removed by the bank");
  if (input.amount != null && !(Number.isFinite(input.amount) && input.amount > 0)) throw new UserError("Amount must be more than $0");

  const links = await store.select("reimbursement_links");
  const totals = linkTotals(links);
  const expenseLeft = remainingCents(expense, totals);
  const incomeLeft = remainingCents(income, totals);
  const amountC = input.amount != null ? toCents(input.amount) : Math.min(expenseLeft, incomeLeft);
  if (amountC <= 0) {
    throw new UserError(
      expenseLeft <= 0 ? `${label(expense)} is already fully netted off` : `That payment is already fully allocated`,
    );
  }
  if (amountC > expenseLeft) {
    throw new UserError(`Can't link ${formatCents(amountC)}: only ${formatCents(expenseLeft)} of ${label(expense)} is left to net off`);
  }
  if (amountC > incomeLeft) {
    throw new UserError(`Can't link ${formatCents(amountC)}: only ${formatCents(incomeLeft)} of ${label(income)} is unallocated`);
  }

  const existing = links.find((l) => l.expense_id === expense.id && l.income_id === income.id);
  let link: ReimbursementLink;
  if (existing) {
    const total = fromCents(toCents(existing.amount) + amountC);
    await store.update("reimbursement_links", { eq: { id: existing.id } }, { amount: total });
    link = { ...existing, amount: total };
  } else {
    [link] = await store.insert("reimbursement_links", [
      { expense_id: expense.id, income_id: income.id, amount: fromCents(amountC), iou_id: null, iou_amount: 0 },
    ]);
  }
  // Settle (part of) a matching open IOU on this expense, if any.
  const settled = await applyLinkToIou(store, { expense, income, amountCents: amountC, preferIouId: link.iou_id ?? input.iou_id });
  if (settled) {
    const patch = { iou_id: settled.iouId, iou_amount: fromCents(toCents(link.iou_amount ?? 0) + settled.appliedCents) };
    await store.update("reimbursement_links", { eq: { id: link.id } }, patch);
    link = { ...link, ...patch };
  }
  const after = linkTotals(existing ? links.map((l) => (l.id === link.id ? link : l)) : [...links, link]);
  return {
    link,
    amount: fromCents(amountC),
    expense: { id: expense.id, name: clip(label(expense)), gross: Math.abs(expense.amount), net: Math.abs(netAmount(expense, after)) },
    income: { id: income.id, name: clip(label(income)), amount: income.amount, unallocated: remainingOf(income, after) },
  };
}

export async function unlinkReimbursement(store: Store, linkId: string): Promise<boolean> {
  const [link] = await store.select("reimbursement_links", { eq: { id: linkId } });
  if (!link) return false;
  await reverseIouForLink(store, link);
  return (await store.remove("reimbursement_links", { eq: { id: linkId } })) > 0;
}

/**
 * Remove links and dependants of these transactions (Postgres cascades; the
 * JSON store doesn't). IOU balances settled by removed links are restored.
 */
export async function removeLinksFor(store: Store, txnIds: string[]): Promise<void> {
  if (!txnIds.length) return;
  const links = [
    ...(await store.select("reimbursement_links", { in: { expense_id: txnIds } })),
    ...(await store.select("reimbursement_links", { in: { income_id: txnIds } })),
  ];
  for (const l of links) await reverseIouForLink(store, l);
  await store.remove("reimbursement_links", { in: { expense_id: txnIds } });
  await store.remove("reimbursement_links", { in: { income_id: txnIds } });
  await store.remove("netoff_suggestions", { in: { expense_id: txnIds } });
  await store.remove("netoff_suggestions", { in: { income_id: txnIds } });
  await store.remove("ious", { in: { expense_id: txnIds } });
  await store.remove("trip_transactions", { in: { transaction_id: txnIds } });
}

export interface LinkView {
  link_id: string;
  other_id: string;
  other_name: string;
  other_date: string;
  amount: number;
}

export interface NetView {
  net_amount: number;
  /** on expenses: who paid back */
  reimbursed_by: LinkView[];
  /** on credits: which expenses it covers */
  linked_to: LinkView[];
  /** on credits with links: what's left unallocated */
  unallocated: number | null;
}

/** Decorate transactions for the UI with net amounts and link details. */
export async function describeNet<T extends Transaction>(store: Store, txns: T[]): Promise<(T & NetView)[]> {
  const links = await store.select("reimbursement_links");
  const totals = linkTotals(links);
  const relevant = new Set(txns.map((t) => t.id));
  const touched = links.filter((l) => relevant.has(l.expense_id) || relevant.has(l.income_id));
  const otherIds = [...new Set(touched.flatMap((l) => [l.expense_id, l.income_id]))];
  const others = otherIds.length ? await store.select("transactions", { in: { id: otherIds } }) : [];
  const byId = new Map(others.map((o) => [o.id, o]));
  const view = (l: ReimbursementLink, otherId: string): LinkView => {
    const o = byId.get(otherId);
    return {
      link_id: l.id,
      other_id: otherId,
      other_name: o ? label(o) : "(deleted)",
      other_date: o?.local_date ?? "",
      amount: Number(l.amount),
    };
  };
  return txns.map((t) => {
    const reimbursed_by = touched.filter((l) => l.expense_id === t.id).map((l) => view(l, l.income_id));
    const linked_to = touched.filter((l) => l.income_id === t.id).map((l) => view(l, l.expense_id));
    return {
      ...t,
      net_amount: netAmount(t, totals),
      reimbursed_by,
      linked_to,
      unallocated: linked_to.length ? remainingOf(t, totals) : null,
    };
  });
}

export interface CandidateFilter {
  q?: string;
  min_amount?: number;
  max_amount?: number;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Text match on merchant/description. With `loose` (payer names only), also
 * accept any single word of 3+ letters ("Sam Wilson" ~ "S WILSON").
 */
export function nameMatches(
  needle: string,
  t: Pick<Transaction, "merchant_name" | "description">,
  loose = false,
): boolean {
  const hay = `${normalise(t.merchant_name)} ${normalise(t.description)}`;
  const n = normalise(needle);
  if (!n) return true;
  if (hay.includes(n) || hay.replaceAll(" ", "").includes(n.replaceAll(" ", ""))) return true;
  const words = n.split(" ").filter((w) => w.length >= 3);
  return loose && words.length > 1 && words.some((w) => ` ${hay} `.includes(` ${w} `));
}

/** Incoming money (credits) for the Net off picker, most recent first. */
export async function incomingCandidates(store: Store, f: CandidateFilter) {
  const filter: Filter<Transaction> = { gte: {}, lte: {} };
  if (f.from) filter.gte!.local_date = f.from;
  if (f.to) filter.lte!.local_date = f.to;
  const [rows, totals] = await Promise.all([
    store.select("transactions", filter, { order: { column: "date", ascending: false } }),
    loadLinkTotals(store),
  ]);
  return rows
    .filter((t) => t.amount > 0)
    .filter((t) => !f.q || nameMatches(f.q, t, true))
    .filter((t) => f.min_amount == null || t.amount >= f.min_amount)
    .filter((t) => f.max_amount == null || t.amount <= f.max_amount)
    .slice(0, f.limit ?? 50)
    .map((t) => ({
      id: t.id,
      local_date: t.local_date,
      description: t.description,
      merchant_name: t.merchant_name,
      amount: t.amount,
      allocated: totals.fromIncome.get(t.id) ?? 0,
      unallocated: remainingOf(t, totals),
    }));
}

type Brief = { id: string; date: string; description: string; amount: number; remaining: number };

/**
 * Chat helper: resolve "the $100 from Sam was for Snus Direct" to exactly one
 * expense and one incoming payment. Returns candidates instead of linking when
 * anything is ambiguous, so the assistant can ask which one.
 */
export async function matchAndLink(
  store: Store,
  q: {
    expense?: string;
    expense_amount?: number;
    expense_date?: string;
    income_from?: string;
    income_amount?: number;
    income_date?: string;
    amount?: number;
    fraction?: number;
    expense_id?: string;
    income_id?: string;
  },
): Promise<
  | { status: "linked"; result: Awaited<ReturnType<typeof linkReimbursement>> }
  | { status: "needs_choice"; expense_candidates: Brief[]; income_candidates: Brief[]; amount: number | null }
  | { status: "not_found"; message: string }
> {
  const today = todayLocal();
  const [all, totals] = await Promise.all([
    store.select("transactions", { gte: { local_date: addDays(today, -180) } }, { order: { column: "date", ascending: false } }),
    loadLinkTotals(store),
  ]);
  const near = (t: Transaction, date?: string) =>
    !date || (t.local_date >= addDays(date, -3) && t.local_date <= addDays(date, 3));
  const amt = (t: Transaction, want?: number) => want == null || Math.abs(toCents(t.amount)) === toCents(want);
  const brief = (t: Transaction): Brief => ({
    id: t.id,
    date: t.local_date,
    description: clip(t.merchant_name ?? t.description),
    amount: t.amount,
    remaining: remainingOf(t, totals),
  });

  let expenses = q.expense_id
    ? all.filter((t) => t.id === q.expense_id)
    : all.filter(
        (t) =>
          t.amount < 0 &&
          !t.is_transfer &&
          !t.removed_at &&
          remainingOf(t, totals) > 0 &&
          (!q.expense || nameMatches(q.expense, t)) &&
          near(t, q.expense_date) &&
          amt(t, q.expense_amount),
      );
  if (q.expense_id && !expenses.length) {
    const [e] = await store.select("transactions", { eq: { id: q.expense_id } });
    if (e) expenses = [e];
  }
  if (!expenses.length) {
    return { status: "not_found", message: `No unreimbursed expense matching "${q.expense ?? q.expense_id}" in the last 6 months.` };
  }

  // Amount to link, if we can already tell.
  const single = expenses.length === 1 ? expenses[0] : undefined;
  // (null → link the smaller of the two remainders)
  const amount: number | null =
    q.amount ?? (q.fraction != null && single ? fromCents(Math.round(Math.abs(toCents(single.amount)) * q.fraction)) : null);

  let incomes = q.income_id
    ? all.filter((t) => t.id === q.income_id)
    : all.filter(
        (t) =>
          t.amount > 0 &&
          !t.removed_at &&
          remainingOf(t, totals) > 0 &&
          (!q.income_from || nameMatches(q.income_from, t, true)) &&
          near(t, q.income_date) &&
          amt(t, q.income_amount) &&
          (!single || t.local_date >= addDays(single.local_date, -7)),
      );
  if (q.income_id && !incomes.length) {
    const [i] = await store.select("transactions", { eq: { id: q.income_id } });
    if (i) incomes = [i];
  }
  // "Half of dinner": prefer payments that fit the computed share.
  if (!q.income_id && amount != null && incomes.length > 1) {
    const fit = incomes.filter((t) => Math.abs(remainingCents(t, totals) - toCents(amount!)) < 100);
    if (fit.length) incomes = fit;
  }
  if (!incomes.length) {
    return {
      status: "not_found",
      message: `No incoming payment${q.income_from ? ` from "${q.income_from}"` : ""}${q.income_amount ? ` of $${q.income_amount}` : ""} with money left to allocate.`,
    };
  }
  if (expenses.length > 1 || incomes.length > 1) {
    return {
      status: "needs_choice",
      expense_candidates: expenses.slice(0, 8).map(brief),
      income_candidates: incomes.slice(0, 8).map(brief),
      amount,
    };
  }
  const result = await linkReimbursement(store, {
    expense_id: expenses[0].id,
    income_id: incomes[0].id,
    amount: amount ?? undefined,
  });
  return { status: "linked", result };
}

/** Expenses (last 6 months, newest first) matching a name/amount/date, for chat tools. */
export async function findExpenseCandidates(
  store: Store,
  q: { expense?: string; expense_amount?: number; expense_date?: string; expense_id?: string },
): Promise<Transaction[]> {
  if (q.expense_id) return store.select("transactions", { eq: { id: q.expense_id } });
  const today = todayLocal();
  const rows = await store.select(
    "transactions",
    { gte: { local_date: addDays(today, -180) } },
    { order: { column: "date", ascending: false } },
  );
  return rows.filter(
    (t) =>
      t.amount < 0 &&
      !t.is_transfer &&
      !t.removed_at &&
      (!q.expense || nameMatches(q.expense, t)) &&
      (!q.expense_date || (t.local_date >= addDays(q.expense_date, -3) && t.local_date <= addDays(q.expense_date, 3))) &&
      (q.expense_amount == null || -toCents(t.amount) === toCents(q.expense_amount)),
  );
}

import "server-only";
import type { Store } from "@/lib/store/types";
import type { Category, NetoffSuggestion, Transaction } from "@/lib/types";
import { addDays, daysBetween, todayLocal } from "@/lib/dates";
import { formatCents, fromCents, toCents, type Cents } from "@/lib/money";
import { rootOf } from "@/lib/categories";
import { linkTotals, linkReimbursement, remainingCents } from "@/lib/reimburse";
import { balanceCents, personMatches } from "@/lib/iou";
import { UserError } from "@/lib/errors";

/**
 * Auto-suggested Net offs. After a sync we look at new incoming credits that
 * look like a person paying me back (not Salary/income, not Transfers, not a
 * merchant refund) and score expenses from the previous 14 days:
 *   +100  an open IOU on the expense names the payer   (strongest)
 *    +50  amount equals the whole expense
 *    +40  … half,  +30 a third or a quarter
 *   0–10  recency (closer = higher)
 * Suggestions are only ever applied when the user taps Accept; dismissed ones
 * are kept (unique on income+expense) so they never come back.
 */

export const SUGGEST_WINDOW_DAYS = 14;
const MAX_PER_CREDIT = 3;

export function isPersonalCredit(t: Transaction, cats: Category[]): boolean {
  if (t.amount <= 0 || t.is_transfer || t.removed_at) return false;
  const root = rootOf(cats, t.category_id);
  if (root && root.kind !== "expense") return false; // Salary/income, Transfers
  // Merchant refunds carry merchant/Akahu enrichment; mates' payments don't.
  if (t.merchant_name || t.akahu_category) return false;
  if (root && t.category_source !== "manual") return false; // refund categorised by rule/hint
  return true;
}

const FRACTIONS: [number, number, string][] = [
  [1, 50, "same amount"],
  [2, 40, "half"],
  [3, 30, "a third"],
  [4, 30, "a quarter"],
];

export async function generateSuggestions(store: Store, opts: { since?: string; today?: string } = {}): Promise<number> {
  const today = opts.today ?? todayLocal();
  const since = opts.since ?? addDays(today, -SUGGEST_WINDOW_DAYS);
  const [cats, txns, links, ious] = await Promise.all([
    store.select("categories"),
    store.select("transactions", { gte: { local_date: addDays(since, -SUGGEST_WINDOW_DAYS) } }),
    store.select("reimbursement_links"),
    store.select("ious", { eq: { status: "open" } }),
  ]);
  const totals = linkTotals(links);
  const credits = txns.filter((t) => t.local_date >= since && isPersonalCredit(t, cats) && remainingCents(t, totals) > 0);
  const expenses = txns.filter((t) => t.amount < 0 && !t.is_transfer && !t.removed_at && remainingCents(t, totals) > 0);
  const rows: Partial<NetoffSuggestion>[] = [];
  for (const c of credits) {
    const creditLeft = remainingCents(c, totals);
    const scored: Partial<NetoffSuggestion>[] = [];
    for (const e of expenses) {
      const age = daysBetween(e.local_date, c.local_date);
      if (age < 0 || age > SUGGEST_WINDOW_DAYS) continue;
      const expenseLeft = remainingCents(e, totals);
      const gross = -toCents(e.amount);
      let score = 0;
      const reasons: string[] = [];
      let amount: Cents = Math.min(creditLeft, expenseLeft);
      let iouId: string | null = null;
      const iou = ious.find((i) => i.expense_id === e.id && balanceCents(i) > 0 && personMatches(i.person_name, c));
      if (iou) {
        score += 100;
        iouId = iou.id;
        amount = Math.min(creditLeft, expenseLeft, balanceCents(iou));
        reasons.push(`${iou.person_name} owes ${formatCents(balanceCents(iou))}`);
      }
      const frac = FRACTIONS.find(([d]) => {
        const share = Math.round(gross / d);
        // A split can round either way ($141.95 ÷ 2 → $70.97 or $70.98): allow 1c.
        return Math.abs(share - toCents(c.amount)) <= (d === 1 ? 0 : 1) && share <= expenseLeft + 1;
      });
      if (frac) {
        score += frac[1];
        if (!iou) amount = Math.min(creditLeft, expenseLeft, toCents(c.amount));
        reasons.push(frac[0] === 1 ? `same amount as ${formatCents(gross)}` : `${frac[2]} of ${formatCents(gross)}`);
      }
      if (!score) continue;
      score += Math.round((10 * (SUGGEST_WINDOW_DAYS - age)) / SUGGEST_WINDOW_DAYS);
      reasons.push(age === 0 ? "same day" : `${age} day${age === 1 ? "" : "s"} earlier`);
      if (amount <= 0) continue;
      scored.push({ income_id: c.id, expense_id: e.id, iou_id: iouId, amount: fromCents(amount), score, reason: reasons.join(" · "), status: "pending" });
    }
    rows.push(...scored.sort((a, b) => b.score! - a.score!).slice(0, MAX_PER_CREDIT));
  }
  if (!rows.length) return 0;
  // ignoreDuplicates: never resurrect a dismissed/accepted suggestion.
  const created = await store.upsert("netoff_suggestions", rows, "user_id,income_id,expense_id", { ignoreDuplicates: true });
  return created.length;
}

export async function pendingSuggestions(store: Store) {
  const [sugs, links] = await Promise.all([
    store.select("netoff_suggestions", { eq: { status: "pending" } }),
    store.select("reimbursement_links"),
  ]);
  if (!sugs.length) return [];
  const totals = linkTotals(links);
  const ids = [...new Set(sugs.flatMap((s) => [s.income_id, s.expense_id]))];
  const txns = await store.select("transactions", { in: { id: ids } });
  const byId = new Map(txns.map((t) => [t.id, t]));
  return sugs
    .map((s) => ({ s, income: byId.get(s.income_id), expense: byId.get(s.expense_id) }))
    .filter((x): x is { s: NetoffSuggestion; income: Transaction; expense: Transaction } =>
      Boolean(x.income && x.expense && remainingCents(x.income, totals) > 0 && remainingCents(x.expense, totals) > 0),
    )
    .sort((a, b) => b.s.score - a.s.score || b.income.date.localeCompare(a.income.date))
    .map(({ s, income, expense }) => ({
      ...s,
      amount: fromCents(Math.min(toCents(s.amount), remainingCents(income, totals), remainingCents(expense, totals))),
      income: { id: income.id, date: income.local_date, description: income.description, amount: income.amount },
      expense: { id: expense.id, date: expense.local_date, description: expense.merchant_name ?? expense.description, amount: expense.amount },
    }));
}

export async function pendingSuggestionCount(store: Store): Promise<number> {
  return (await pendingSuggestions(store)).length;
}

/** The only path that turns a suggestion into a link: an explicit Accept. */
export async function acceptSuggestion(store: Store, id: string) {
  const current = (await pendingSuggestions(store)).find((s) => s.id === id);
  if (!current) throw new UserError("That suggestion is no longer available");
  const result = await linkReimbursement(store, {
    expense_id: current.expense_id,
    income_id: current.income_id,
    amount: current.amount,
    iou_id: current.iou_id,
  });
  await store.update("netoff_suggestions", { eq: { id } }, { status: "accepted" });
  return result;
}

export async function dismissSuggestion(store: Store, id: string) {
  const n = await store.update("netoff_suggestions", { eq: { id, status: "pending" } }, { status: "dismissed" });
  if (!n) throw new UserError("That suggestion is no longer available");
  return { dismissed: true };
}

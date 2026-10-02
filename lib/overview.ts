import "server-only";
import type { Store } from "@/lib/store/types";
import type { Category } from "@/lib/types";
import { budgetStatus, spendCentsOf, spendingByCategory, UserError, type PeriodMode } from "@/lib/services";
import { listSubscriptions } from "@/lib/subscriptions";
import { currentCycle } from "@/lib/paycycle";
import { rootOf } from "@/lib/categories";
import { addDays, daysBetween, todayLocal } from "@/lib/dates";
import { fromCents, toCents, type Cents } from "@/lib/money";

/**
 * The Budget tab: the period's numbers plus what's still to come.
 * Safe to spend = limit − spent − subscriptions still expected before the
 * period ends (only for the current period, and only when there's a limit).
 */
export async function budgetOverview(store: Store, mode: PeriodMode, at?: string) {
  const today = todayLocal();
  const [status, settingsRows, subs] = await Promise.all([
    budgetStatus(store, { mode, at }),
    store.select("settings"),
    listSubscriptions(store).catch(() => ({ subscriptions: [] as Awaited<ReturnType<typeof listSubscriptions>>["subscriptions"] })),
  ]);
  const upcoming = status.is_current
    ? subs.subscriptions
        .filter((x) => !x.lapsed && !x.ignored && x.next_expected >= today && x.next_expected <= status.period_end)
        .map((x) => ({ name: x.name, amount: x.amount, date: x.next_expected }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const upcomingC: Cents = upcoming.reduce((a, u) => a + toCents(u.amount), 0);
  const limit = status.overall_cap ?? (status.total_of_category_budgets || null);
  const spentC = toCents(status.total_spent);
  const safe = limit == null || !status.is_current ? null : fromCents(toCents(limit) - spentC - upcomingC);
  // Next payday: the day after the current pay cycle ends (needs pay frequency in Settings).
  const cyc = currentCycle(settingsRows[0], today);
  const nextPayday = cyc ? addDays(cyc.end, 1) : null;
  return {
    status,
    limit,
    upcoming,
    upcoming_total: fromCents(upcomingC),
    safe_to_spend: safe,
    /** Spent so far plus subscriptions still due, or the straight-line projection if higher. */
    forecast: status.is_current ? Math.max(status.projected_month_spend, fromCents(spentC + upcomingC)) : status.total_spent,
    next_payday: nextPayday,
    days_to_payday: nextPayday ? daysBetween(today, nextPayday) : null,
    period_days_left: status.is_current ? daysBetween(today, status.period_end) + 1 : 0,
  };
}

/** Default groups for the Categories view (by category name; anything else is "Other"). */
const GROUPS: Record<string, string> = {
  Rent: "Housing",
  "Home Supplies": "Housing",
  Insurance: "Housing",
  Groceries: "Food",
  "Eating Out": "Food",
  Takeaways: "Food",
  Bars: "Food & drink",
  "Liquor Stores": "Food & drink",
  Bills: "Utilities",
  Subscriptions: "Lifestyle",
  Entertainment: "Lifestyle",
  Sports: "Lifestyle",
  "Health & Wellness": "Lifestyle",
  "Clothes/Shopping": "Shopping",
  "Transport/Fuel": "Transport",
  Travel: "Travel",
  Salary: "Salary",
};
const groupOf = (c: Category | undefined) => (c ? (GROUPS[c.name] ?? (c.kind === "income" ? "Other income" : "Other")) : "Uncategorised");

export type InsightKind = "spending" | "income";

/**
 * Spending (or income) per category for a period, compared with the period of
 * the same length just before it. Same rules as the home page: net offs at net,
 * refunds reduce, transfers/savings and trips kept separate are left out.
 */
export async function insights(store: Store, kind: InsightKind, from: string, to: string) {
  if (from > to) throw new UserError("from must be on or before to");
  const len = daysBetween(from, to) + 1;
  if (len > 3700) throw new UserError("Period too long");
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -len);
  const [cur, prev] = await Promise.all([totals(store, kind, from, to), totals(store, kind, prevFrom, prevTo)]);
  const ids = new Set([...cur.byCat.keys(), ...prev.byCat.keys()]);
  const cats = cur.cats;
  const rows = [...ids]
    .map((id) => {
      const c = id === "__uncat" ? undefined : cats.find((x) => x.id === id);
      return {
        category_id: c?.id ?? null,
        name: c?.name ?? "Uncategorised",
        color: c?.color ?? "#9ca3af",
        group: groupOf(c),
        current: fromCents(cur.byCat.get(id) ?? 0),
        previous: fromCents(prev.byCat.get(id) ?? 0),
      };
    })
    .filter((r) => r.current !== 0 || r.previous !== 0)
    .sort((a, b) => b.current - a.current || b.previous - a.previous);
  return { kind, from, to, prev_from: prevFrom, prev_to: prevTo, total: fromCents(cur.total), previous_total: fromCents(prev.total), rows };
}

async function totals(store: Store, kind: InsightKind, from: string, to: string) {
  const { txns, cats } = await spendingByCategory(store, from, to);
  const byCat = new Map<string, Cents>();
  let total: Cents = 0;
  for (const t of txns) {
    if (t.removed_at || t.is_transfer) continue;
    const root = rootOf(cats, t.category_id);
    let c: Cents;
    if (kind === "spending") {
      c = spendCentsOf(t, cats);
      if (!c && root?.kind !== "expense") continue;
    } else {
      // Income: income-kind categories, plus uncategorised money in.
      if (root ? root.kind !== "income" : t.amount <= 0) continue;
      c = toCents(t.amount);
    }
    const k = root?.id ?? "__uncat";
    byCat.set(k, (byCat.get(k) ?? 0) + c);
    total += c;
  }
  return { byCat, total, cats };
}

/** Spend per day (same rules as the totals), for the Activity calendar. */
export async function dailySpend(store: Store, from: string, to: string) {
  if (from > to) throw new UserError("from must be on or before to");
  if (daysBetween(from, to) > 62) throw new UserError("At most two months at a time");
  const { txns, cats } = await spendingByCategory(store, from, to);
  const days = new Map<string, { spent: Cents; income: Cents; count: number }>();
  for (const t of txns) {
    if (t.removed_at || t.is_transfer) continue;
    const d = days.get(t.local_date) ?? { spent: 0, income: 0, count: 0 };
    const root = rootOf(cats, t.category_id);
    d.spent += spendCentsOf(t, cats);
    if (root?.kind === "income") d.income += toCents(t.amount);
    d.count++;
    days.set(t.local_date, d);
  }
  return {
    from,
    to,
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, spent: fromCents(d.spent), income: fromCents(d.income), count: d.count })),
  };
}

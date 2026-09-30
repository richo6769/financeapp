import "server-only";
import type { Store } from "@/lib/store/types";
import { addMonths, monthKey, monthLabel, monthStart, todayLocal } from "@/lib/dates";
import { fromCents, sumCents, toCents, type Cents } from "@/lib/money";
import { budgetStatus, spendCentsOf, spendingByCategory, type PeriodMode } from "@/lib/services";
import { pendingSuggestionCount } from "@/lib/suggest";
import { weeklyCapStatus } from "@/lib/caps";
import { balanceCents } from "@/lib/iou";

export async function dashboard(store: Store, mode: PeriodMode = "month") {
  const today = todayLocal();
  const status = await budgetStatus(store, { mode });
  const trendFrom = monthStart(addMonths(today, -5));
  const [{ txns, cats }, accounts, pending, lastSync, uncategorised, suggestions, weekly, recap, ious] = await Promise.all([
    spendingByCategory(store, trendFrom, today),
    store.select("accounts"),
    store.select("pending_transactions"),
    store.select("sync_log", undefined, { order: { column: "started_at", ascending: false }, limit: 1 }),
    store.select("transactions", { eq: { category_id: null } }),
    pendingSuggestionCount(store),
    weeklyCapStatus(store),
    store.select("weekly_recaps", undefined, { order: { column: "week_start", ascending: false }, limit: 1 }),
    store.select("ious", { eq: { status: "open" } }),
  ]);
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) months.push(monthKey(addMonths(monthStart(today), -i)));
  const trend = months.map((m) => ({
    month: m,
    label: monthLabel(m),
    spent: fromCents(txns.filter((t) => monthKey(t.local_date) === m).reduce((a, t) => a + spendCentsOf(t, cats), 0)),
  }));
  const merchants = new Map<string, { spent: Cents; count: number }>();
  for (const t of txns.filter((x) => x.local_date >= status.from)) {
    const s = spendCentsOf(t, cats);
    if (s <= 0) continue;
    const key = t.merchant_name ?? t.description;
    const cur = merchants.get(key) ?? { spent: 0, count: 0 };
    cur.spent += s;
    cur.count++;
    merchants.set(key, cur);
  }
  return {
    status,
    trend,
    top_merchants: [...merchants.entries()]
      .sort((a, b) => b[1].spent - a[1].spent)
      .slice(0, 6)
      .map(([name, v]) => ({ name, spent: fromCents(v.spent), count: v.count })),
    accounts,
    pending: pending.sort((a, b) => b.date.localeCompare(a.date)),
    last_sync: lastSync[0] ?? null,
    uncategorised_count: uncategorised.filter((t) => !t.removed_at).length,
    suggestion_count: suggestions,
    weekly,
    latest_recap: recap[0] ?? null,
    owed_to_me: fromCents(ious.reduce((a, i) => a + balanceCents(i), 0)),
  };
}

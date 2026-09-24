import "server-only";
import type { Store } from "@/lib/store/types";
import type { Transaction } from "@/lib/types";
import { addDays, addMonths, daysBetween, todayLocal } from "@/lib/dates";
import { fromCents, mulDiv, toCents, type Cents } from "@/lib/money";
import { merchantPattern, normalise } from "@/lib/categorise";
import { UserError } from "@/lib/errors";

/**
 * Recurring-charge detection:
 *  - same merchant (merchant name, else the first words of the description)
 *  - amounts within ±10% of the series' median
 *  - a regular interval: weekly (6–8 days), fortnightly (13–15),
 *    monthly (27–33) or yearly (355–375)
 *  - at least 3 charges (2 for yearly), with ≥70% of gaps on that interval
 * Flags: price increase >5% on the latest charge, newly started series, and
 * an expected charge that hasn't arrived. "Not a subscription" is remembered.
 */

export type Frequency = "weekly" | "fortnightly" | "monthly" | "yearly";

const BUCKETS: [Frequency, number, number][] = [
  ["weekly", 6, 8],
  ["fortnightly", 13, 15],
  ["monthly", 27, 33],
  ["yearly", 355, 375],
];
const GRACE: Record<Frequency, number> = { weekly: 2, fortnightly: 3, monthly: 5, yearly: 14 };
const TO_MONTHLY: Record<Frequency, [number, number]> = { weekly: [52, 12], fortnightly: [26, 12], monthly: [1, 1], yearly: [1, 12] };

export function merchantKey(t: Pick<Transaction, "merchant_name" | "description">): string {
  return normalise(t.merchant_name) || normalise(merchantPattern(t).pattern);
}

function bucketOf(days: number): Frequency | null {
  return BUCKETS.find(([, lo, hi]) => days >= lo && days <= hi)?.[0] ?? null;
}

function nextAfter(last: string, f: Frequency): string {
  if (f === "weekly") return addDays(last, 7);
  if (f === "fortnightly") return addDays(last, 14);
  if (f === "monthly") return addMonths(last, 1);
  return addMonths(last, 12);
}

export interface DetectedSub {
  key: string;
  name: string;
  frequency: Frequency;
  amount: number; // latest charge
  monthly_equivalent: number;
  occurrences: number;
  first_date: string;
  last_date: string;
  next_expected: string;
  price_increase: { from: number; to: number; pct: number } | null;
  is_new: boolean;
  missed: boolean;
  lapsed: boolean;
  ignored: boolean;
}

export function detectFromTransactions(txns: Transaction[], today = todayLocal()): Omit<DetectedSub, "ignored">[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.amount >= 0 || t.is_transfer || t.removed_at || t.is_manual) continue;
    if (t.local_date < addDays(today, -400)) continue;
    const k = merchantKey(t);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const out: Omit<DetectedSub, "ignored">[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const amounts = rows.map((r) => -toCents(r.amount)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    // ±10% of the median, compared in integer cents.
    const series = rows
      .filter((r) => Math.abs(-toCents(r.amount) - median) * 10 <= median)
      .sort((a, b) => a.local_date.localeCompare(b.local_date));
    if (series.length < 2) continue;
    const gaps = series.slice(1).map((r, i) => daysBetween(series[i].local_date, r.local_date));
    const counts = new Map<Frequency, number>();
    for (const g of gaps) {
      const b = bucketOf(g);
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    const [frequency, hits] = best;
    const occurrences = hits + 1;
    if (occurrences < (frequency === "yearly" ? 2 : 3)) continue;
    if (hits * 10 < gaps.length * 7) continue;
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    const lastC: Cents = -toCents(last.amount);
    const prevC: Cents = -toCents(prev.amount);
    const next = nextAfter(last.local_date, frequency);
    const overdue = daysBetween(next, today);
    const [num, den] = TO_MONTHLY[frequency];
    const intervalDays = frequency === "weekly" ? 7 : frequency === "fortnightly" ? 14 : frequency === "monthly" ? 30 : 365;
    out.push({
      key,
      name: last.merchant_name ?? merchantPattern(last).pattern.toUpperCase(),
      frequency,
      amount: fromCents(lastC),
      monthly_equivalent: fromCents(mulDiv(lastC, num, den)),
      occurrences,
      first_date: series[0].local_date,
      last_date: last.local_date,
      next_expected: next,
      price_increase:
        lastC * 100 > prevC * 105 ? { from: fromCents(prevC), to: fromCents(lastC), pct: Math.round(((lastC - prevC) * 100) / prevC) } : null,
      is_new: daysBetween(series[0].local_date, today) <= Math.round(intervalDays * 2.5) + GRACE[frequency],
      missed: overdue > GRACE[frequency],
      lapsed: overdue > intervalDays * 2,
    });
  }
  return out.sort((a, b) => b.monthly_equivalent - a.monthly_equivalent);
}

export async function listSubscriptions(store: Store, today = todayLocal()) {
  const [txns, prefs] = await Promise.all([
    store.select("transactions", { gte: { local_date: addDays(today, -400) } }),
    store.select("subscription_prefs"),
  ]);
  const detected = detectFromTransactions(txns, today);
  // Remember first detection (for "new since last week" in recaps).
  const unseen = detected.filter((d) => !prefs.some((p) => p.merchant_key === d.key));
  if (unseen.length) {
    await store.upsert(
      "subscription_prefs",
      unseen.map((d) => ({ merchant_key: d.key, status: "tracked" as const, first_detected_on: today })),
      "user_id,merchant_key",
      { ignoreDuplicates: true },
    );
  }
  const subs: DetectedSub[] = detected.map((d) => ({
    ...d,
    ignored: prefs.some((p) => p.merchant_key === d.key && p.status === "ignored"),
  }));
  const active = subs.filter((s) => !s.ignored && !s.lapsed);
  return {
    monthly_total: fromCents(active.reduce((a, s) => a + toCents(s.monthly_equivalent), 0)),
    subscriptions: subs.filter((s) => !s.ignored),
    ignored: subs.filter((s) => s.ignored),
    alerts: {
      price_increases: active.filter((s) => s.price_increase).length,
      new: active.filter((s) => s.is_new).length,
      missed: active.filter((s) => s.missed).length,
    },
  };
}

export async function setSubscriptionIgnored(store: Store, key: string, ignored: boolean) {
  const k = normalise(key);
  if (!k) throw new UserError("Missing subscription key");
  await store.upsert(
    "subscription_prefs",
    [{ merchant_key: k, status: ignored ? "ignored" : "tracked", first_detected_on: todayLocal() }],
    "user_id,merchant_key",
  );
  return { key: k, ignored };
}

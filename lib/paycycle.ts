import "server-only";
import type { Store } from "@/lib/store/types";
import type { PayFrequency, Settings } from "@/lib/types";
import { addDays, addMonths, daysBetween, daysInMonth, todayLocal } from "@/lib/dates";
import { rootOf } from "@/lib/categories";

export interface Cycle {
  start: string; // payday (inclusive)
  end: string; // day before the next payday (inclusive)
  lengthDays: number;
  frequency: PayFrequency;
}

const LENGTH: Record<Exclude<PayFrequency, "monthly">, number> = { weekly: 7, fortnightly: 14 };

function monthlyOn(ld: string, day: number): string {
  const y = Number(ld.slice(0, 4));
  const m = Number(ld.slice(5, 7));
  return `${ld.slice(0, 7)}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, "0")}`;
}

/**
 * The pay cycle containing `date`. Any known payday works as the anchor.
 * Pure calendar-date maths (no timestamps), so DST changeovers can't shift it.
 */
export function cycleFor(frequency: PayFrequency, anchor: string, date: string): Cycle {
  if (frequency === "monthly") {
    const day = Number(anchor.slice(8, 10));
    let start = monthlyOn(date, day);
    if (start > date) start = monthlyOn(addMonths(`${date.slice(0, 7)}-01`, -1), day);
    const next = monthlyOn(addMonths(`${start.slice(0, 7)}-01`, 1), day);
    return { start, end: addDays(next, -1), lengthDays: daysBetween(start, next), frequency };
  }
  const len = LENGTH[frequency];
  const k = Math.floor(daysBetween(anchor, date) / len);
  const start = addDays(anchor, k * len);
  return { start, end: addDays(start, len - 1), lengthDays: len, frequency };
}

export function currentCycle(settings: Pick<Settings, "pay_frequency" | "next_payday"> | undefined, today = todayLocal()) {
  if (!settings?.pay_frequency || !settings.next_payday) return null;
  return cycleFor(settings.pay_frequency, settings.next_payday, today);
}

export interface PayDetection {
  frequency: PayFrequency;
  next_payday: string;
  last_payday: string;
  paydays: string[];
  median_interval_days: number;
}

/**
 * Detect pay frequency from Salary-*category* credits (never by employer
 * name), so switching employers — e.g. Deloitte → ZURU — keeps working.
 * The most recent payday becomes the anchor.
 */
export async function detectPayCycle(store: Store, today = todayLocal()): Promise<PayDetection | null> {
  const [cats, txns] = await Promise.all([
    store.select("categories"),
    store.select("transactions", { gte: { local_date: addDays(today, -200) }, lte: { local_date: today } }),
  ]);
  const paydays = [
    ...new Set(
      txns
        .filter((t) => t.amount > 0 && !t.is_transfer && !t.removed_at && rootOf(cats, t.category_id)?.kind === "income")
        .map((t) => t.local_date),
    ),
  ].sort();
  if (paydays.length < 3) return null;
  const intervals = paydays.slice(1).map((d, i) => daysBetween(paydays[i], d)).filter((n) => n >= 5);
  if (intervals.length < 2) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const frequency: PayFrequency | null =
    median >= 6 && median <= 8 ? "weekly" : median >= 12 && median <= 16 ? "fortnightly" : median >= 26 && median <= 35 ? "monthly" : null;
  if (!frequency) return null;
  const last = paydays[paydays.length - 1];
  let next = last;
  for (let i = 0; i < 60 && next <= today; i++) {
    next = frequency === "monthly" ? monthlyOn(addMonths(`${next.slice(0, 7)}-01`, 1), Number(last.slice(8, 10))) : addDays(next, LENGTH[frequency]);
  }
  return { frequency, next_payday: next, last_payday: last, paydays: paydays.slice(-6), median_interval_days: median };
}

export async function savePayCycle(store: Store, frequency: PayFrequency | null, nextPayday: string | null) {
  await store.upsert("settings", [{ pay_frequency: frequency, next_payday: frequency ? nextPayday : null }], "user_id");
}

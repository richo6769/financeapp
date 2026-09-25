import type { BudgetPeriod } from "@/lib/types";

/**
 * Money maths is done in integer cents. Values arrive as numbers or decimal
 * strings with at most 2dp (Postgres numeric(14,2) / Akahu JSON); every sum,
 * difference, ratio and conversion happens on integers, and we only convert
 * back to dollars (a number with ≤2dp) at the edges for JSON/display.
 */
export type Cents = number;

/** Parse dollars → integer cents without float multiplication drift. */
export function toCents(v: number | string | null | undefined): Cents {
  if (v == null || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Invalid money amount: ${v}`);
    // Stored amounts have ≤2dp, so |v*100 - exact| < 0.5 and rounding is exact.
    return Math.round(v * 100);
  }
  const m = v.trim().match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[2] && !m[3])) throw new Error(`Invalid money amount: ${v}`);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = Number(m[2] || "0");
  const frac = (m[3] ?? "").padEnd(3, "0");
  // Round half away from zero on the third decimal.
  let cents = whole * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) throw new Error(`Money amount out of range: ${v}`);
  cents *= sign;
  return cents === 0 ? 0 : cents;
}

/** Integer cents → dollars (exactly representable to 2dp for display/JSON). */
export function fromCents(c: Cents): number {
  const d = c / 100;
  return d === 0 ? 0 : d; // avoid -0
}

/** Sum dollar amounts exactly. */
export function sumCents(values: Iterable<number | string>): Cents {
  let total = 0;
  for (const v of values) total += toCents(v);
  return total;
}

/** Exact dollars sum, returned as dollars. */
export function addMoney(...values: (number | string)[]): number {
  return fromCents(sumCents(values));
}

/** cents × num ÷ den, rounded half away from zero (integers only). */
export function mulDiv(c: Cents, num: number, den: number): Cents {
  const x = (c * num) / den;
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Kept for callers that already hold a 2dp-ish number (rounds via cents). */
export function round2(n: number): number {
  return fromCents(toCents(Number(n.toFixed(6))));
}

const nzd = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const nzd0 = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  maximumFractionDigits: 0,
});

export function formatNZD(n: number, opts?: { whole?: boolean }): string {
  return (opts?.whole ? nzd0 : nzd).format(n);
}

export function formatCents(c: Cents, opts?: { whole?: boolean }): string {
  return formatNZD(fromCents(c), opts);
}

/** Months per period, as integer ratios so conversions stay exact. */
const MONTHLY_RATIO: Record<BudgetPeriod, [number, number]> = {
  weekly: [52, 12],
  fortnightly: [26, 12],
  monthly: [1, 1],
  yearly: [1, 12],
};

/** Convert a periodic amount to a monthly amount and explain the maths. */
export function toMonthly(amount: number, period: BudgetPeriod): { monthly: number; explanation: string } {
  const c = toCents(amount);
  const [num, den] = MONTHLY_RATIO[period];
  const monthly = fromCents(mulDiv(c, num, den));
  const a = formatNZD(fromCents(c));
  switch (period) {
    case "weekly":
      return { monthly, explanation: `${a}/week × 52 ÷ 12 = ${formatNZD(monthly)}/month` };
    case "fortnightly":
      return { monthly, explanation: `${a}/fortnight × 26 ÷ 12 = ${formatNZD(monthly)}/month` };
    case "yearly":
      return { monthly, explanation: `${a}/year ÷ 12 = ${formatNZD(monthly)}/month` };
    default:
      return { monthly, explanation: `${a}/month` };
  }
}

/** Monthly budget → budget for a pay cycle (weekly ×12/52, fortnightly ×12/26). */
export function monthlyToCycleCents(monthlyCents: Cents, frequency: "weekly" | "fortnightly" | "monthly"): Cents {
  if (frequency === "weekly") return mulDiv(monthlyCents, 12, 52);
  if (frequency === "fortnightly") return mulDiv(monthlyCents, 12, 26);
  return monthlyCents;
}

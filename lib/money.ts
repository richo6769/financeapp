import type { BudgetPeriod } from "@/lib/types";

const nzd = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const nzd0 = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  maximumFractionDigits: 0,
});

export function formatNZD(n: number, opts?: { whole?: boolean }): string {
  return (opts?.whole ? nzd0 : nzd).format(n);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Convert a periodic amount to a monthly amount and explain the maths. */
export function toMonthly(amount: number, period: BudgetPeriod): { monthly: number; explanation: string } {
  const a = formatNZD(amount);
  switch (period) {
    case "weekly": {
      const monthly = round2((amount * 52) / 12);
      return { monthly, explanation: `${a}/week × 52 ÷ 12 = ${formatNZD(monthly)}/month` };
    }
    case "fortnightly": {
      const monthly = round2((amount * 26) / 12);
      return { monthly, explanation: `${a}/fortnight × 26 ÷ 12 = ${formatNZD(monthly)}/month` };
    }
    case "yearly": {
      const monthly = round2(amount / 12);
      return { monthly, explanation: `${a}/year ÷ 12 = ${formatNZD(monthly)}/month` };
    }
    default:
      return { monthly: round2(amount), explanation: `${a}/month` };
  }
}

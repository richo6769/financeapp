// Date helpers pinned to Pacific/Auckland. We work with YYYY-MM-DD strings
// ("local dates") for all month/day maths so server TZ never matters.

export const TZ = "Pacific/Auckland";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO timestamp or Date -> YYYY-MM-DD in NZ time. */
export function toLocalDate(d: string | Date): string {
  return fmt.format(typeof d === "string" ? new Date(d) : d);
}

export function todayLocal(now: Date = new Date()): string {
  return toLocalDate(now);
}

function parts(ld: string): [number, number, number] {
  const [y, m, d] = ld.split("-").map(Number);
  return [y, m, d];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Add days to a local date string (calendar arithmetic, DST-safe). */
export function addDays(ld: string, n: number): string {
  const [y, m, d] = parts(ld);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Add months, clamping the day (e.g. 31 Mar - 1 month = 28/29 Feb). */
export function addMonths(ld: string, n: number): string {
  const [y, m, d] = parts(ld);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function monthKey(ld: string): string {
  return ld.slice(0, 7);
}

export function monthStart(ld: string): string {
  return `${ld.slice(0, 7)}-01`;
}

export function monthEnd(ld: string): string {
  const [y, m] = parts(ld);
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}

export function monthLabel(key: string, style: "short" | "long" = "short"): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-NZ", {
    month: style,
    year: style === "long" ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Month progress for budget pacing. */
export function monthProgress(today: string = todayLocal()) {
  const [y, m, d] = parts(today);
  const dim = daysInMonth(y, m);
  return { dayOfMonth: d, daysInMonth: dim, daysLeft: dim - d, fraction: d / dim };
}

export type PeriodPreset =
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "last_6_months"
  | "last_12_months"
  | "year_to_date"
  | "all_time";

/** Resolve a named period to an inclusive [from, to] local-date range. */
export function resolvePeriod(p: PeriodPreset, today: string = todayLocal()): { from: string; to: string } {
  switch (p) {
    case "this_month":
      return { from: monthStart(today), to: today };
    case "last_month": {
      const lm = addMonths(monthStart(today), -1);
      return { from: lm, to: monthEnd(lm) };
    }
    case "last_3_months":
      return { from: addDays(addMonths(today, -3), 1), to: today };
    case "last_6_months":
      return { from: addDays(addMonths(today, -6), 1), to: today };
    case "last_12_months":
      return { from: addDays(addMonths(today, -12), 1), to: today };
    case "year_to_date":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all_time":
      return { from: "1970-01-01", to: today };
  }
}

/** Accepts "yesterday", "today", or YYYY-MM-DD. */
export function parseLocalDate(input: string | undefined, today: string = todayLocal()): string {
  if (!input) return today;
  const s = input.trim().toLowerCase();
  if (s === "today") return today;
  if (s === "yesterday") return addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(input);
  if (!isNaN(d.getTime())) return toLocalDate(d);
  throw new Error(`Unrecognised date: ${input}`);
}

/** Midday NZ time for a local date, as an ISO timestamp (for manual txns). */
export function localDateToIso(ld: string): string {
  // 00:00 UTC on the date is 12:00/13:00 NZ the same calendar day.
  return `${ld}T00:00:00.000Z`;
}

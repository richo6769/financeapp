import "server-only";
import type { Store } from "@/lib/store/types";
import { daysBetween, todayLocal, weekEnd, weekStart } from "@/lib/dates";
import { fromCents, toCents } from "@/lib/money";
import { requireCategory } from "@/lib/categories";
import { spendingByCategory } from "@/lib/services";
import { UserError } from "@/lib/errors";

/** Optional weekly cap per category, Monday–Sunday in NZ time. */
export async function setWeeklyCap(store: Store, categoryRef: string, amount: number | null) {
  const cats = await store.select("categories");
  const cat = requireCategory(cats, categoryRef);
  if (cat.kind !== "expense") throw new UserError("Weekly caps only apply to expense categories");
  if (amount == null) {
    await store.remove("weekly_caps", { eq: { category_id: cat.id } });
    return { category: cat.name, amount: null };
  }
  if (!(amount > 0) || amount > 1_000_000) throw new UserError("Weekly cap must be more than $0");
  await store.upsert("weekly_caps", [{ category_id: cat.id, amount: fromCents(toCents(amount)) }], "user_id,category_id");
  return { category: cat.name, amount: fromCents(toCents(amount)) };
}

export type CapLevel = "ok" | "warn" | "over";

export async function weeklyCapStatus(store: Store, date = todayLocal()) {
  const caps = await store.select("weekly_caps");
  const from = weekStart(date);
  const end = weekEnd(date);
  const base = { week_start: from, week_end: end, days_left: daysBetween(date, end) };
  if (!caps.length) return { ...base, caps: [], alerts: [] };
  const [{ rows }, cats] = await Promise.all([
    spendingByCategory(store, from, date < end ? date : end, { includeUnbudgeted: true }),
    store.select("categories"),
  ]);
  const out = caps
    .map((c) => {
      const cat = cats.find((x) => x.id === c.category_id);
      const row = rows.find((r) => r.category_id === c.category_id);
      const cap = toCents(c.amount);
      const spent = toCents(row?.spent ?? 0);
      const pct = cap > 0 ? Math.max(0, Math.floor((spent * 100) / cap)) : 0;
      const level: CapLevel = spent >= cap ? "over" : spent * 10 >= cap * 8 ? "warn" : "ok";
      return {
        category_id: c.category_id,
        name: cat?.name ?? "(deleted)",
        color: cat?.color ?? null,
        cap: fromCents(cap),
        spent: fromCents(spent),
        remaining: fromCents(cap - spent),
        pct,
        level,
      };
    })
    .sort((a, b) => b.pct - a.pct);
  return { ...base, caps: out, alerts: out.filter((c) => c.level !== "ok") };
}

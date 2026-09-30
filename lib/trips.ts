import "server-only";
import type { Store } from "@/lib/store/types";
import type { Category, Transaction, Trip, TripTransaction } from "@/lib/types";
import { daysBetween, eachDay, todayLocal } from "@/lib/dates";
import { fromCents, toCents, type Cents } from "@/lib/money";
import { categoryLabel, rootOf, requireCategory } from "@/lib/categories";
import { normalise } from "@/lib/categorise";
import { applyNet, loadLinkTotals } from "@/lib/reimburse";
import { UserError } from "@/lib/errors";

/**
 * Trip membership:
 *  - auto: dated within the trip, not a transfer, and either in a foreign
 *    currency or in the Travel category — or anything, when include_all is on
 *  - manual overrides: "include" adds any transaction, "exclude" removes one
 * A transaction belongs to at most one trip (earliest-starting wins).
 */
export function isTravelCategory(cats: Category[], categoryId: string | null): boolean {
  return normalise(rootOf(cats, categoryId)?.name) === "travel";
}

function autoMember(t: Transaction, trip: Trip, cats: Category[]): boolean {
  if (t.is_transfer || t.removed_at) return false;
  if (t.local_date < trip.start_date || t.local_date > trip.end_date) return false;
  if (rootOf(cats, t.category_id)?.kind === "income") return false;
  if (trip.include_all) return t.amount < 0 || rootOf(cats, t.category_id)?.kind === "expense";
  return Boolean(t.foreign_currency && t.foreign_currency !== "NZD") || isTravelCategory(cats, t.category_id);
}

export function computeMembership(
  trips: Trip[],
  overrides: TripTransaction[],
  txns: Transaction[],
  cats: Category[],
): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = [...trips].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const excluded = new Set(overrides.filter((o) => o.mode === "exclude").map((o) => `${o.trip_id}:${o.transaction_id}`));
  for (const o of overrides) if (o.mode === "include" && !out.has(o.transaction_id)) out.set(o.transaction_id, o.trip_id);
  for (const t of txns) {
    if (out.has(t.id)) continue;
    const trip = sorted.find((tr) => !excluded.has(`${tr.id}:${t.id}`) && autoMember(t, tr, cats));
    if (trip) out.set(t.id, trip.id);
  }
  return out;
}

export async function loadMembership(store: Store, txns?: Transaction[]) {
  const [trips, overrides, cats] = await Promise.all([
    store.select("trips"),
    store.select("trip_transactions"),
    store.select("categories"),
  ]);
  if (!trips.length) return { trips, membership: new Map<string, string>() };
  const rows = txns ?? (await store.select("transactions"));
  return { trips, membership: computeMembership(trips, overrides, rows, cats) };
}

/** Transaction ids that must not count toward monthly/weekly budgets. */
export async function monthlyExclusions(store: Store, txns: Transaction[]): Promise<Set<string>> {
  const { trips, membership } = await loadMembership(store, txns);
  const excludeTrips = new Set(trips.filter((t) => t.exclude_from_monthly).map((t) => t.id));
  const out = new Set<string>();
  for (const [txnId, tripId] of membership) if (excludeTrips.has(tripId)) out.add(txnId);
  return out;
}

export async function createTrip(
  store: Store,
  input: { name: string; start_date: string; end_date: string; budget?: number | null; exclude_from_monthly?: boolean; include_all?: boolean },
): Promise<Trip> {
  const name = input.name.trim();
  if (!name) throw new UserError("Trip name is required");
  if (input.end_date < input.start_date) throw new UserError("Trip end date is before the start date");
  if (daysBetween(input.start_date, input.end_date) > 366) throw new UserError("Trips can be at most a year long");
  if (input.budget != null && !(input.budget >= 0)) throw new UserError("Trip budget must be zero or more");
  const [trip] = await store.insert("trips", [
    {
      name,
      start_date: input.start_date,
      end_date: input.end_date,
      budget: input.budget == null ? null : fromCents(toCents(input.budget)),
      exclude_from_monthly: input.exclude_from_monthly ?? true,
      include_all: input.include_all ?? false,
    },
  ]);
  return trip;
}

export async function updateTrip(store: Store, id: string, patch: Partial<Pick<Trip, "name" | "start_date" | "end_date" | "budget" | "exclude_from_monthly" | "include_all">>) {
  const [trip] = await store.select("trips", { eq: { id } });
  if (!trip) throw new UserError("Trip not found");
  const next = { ...trip, ...patch };
  if (next.end_date < next.start_date) throw new UserError("Trip end date is before the start date");
  await store.update("trips", { eq: { id } }, patch);
  return next;
}

export async function deleteTrip(store: Store, id: string) {
  await store.remove("trip_transactions", { eq: { trip_id: id } });
  return store.remove("trips", { eq: { id } });
}

/** Manually add/remove a transaction; "auto" clears the override. */
export async function setTripMembership(store: Store, tripId: string, transactionId: string, mode: "include" | "exclude" | "auto") {
  const [[trip], [txn]] = await Promise.all([
    store.select("trips", { eq: { id: tripId } }),
    store.select("transactions", { eq: { id: transactionId } }),
  ]);
  if (!trip) throw new UserError("Trip not found");
  if (!txn) throw new UserError("Transaction not found");
  await store.remove("trip_transactions", { eq: { transaction_id: transactionId } });
  if (mode !== "auto") await store.insert("trip_transactions", [{ trip_id: tripId, transaction_id: transactionId, mode }]);
}

export function findTrip(trips: Trip[], ref?: string): Trip | undefined {
  if (!ref) {
    const today = todayLocal();
    return (
      trips.find((t) => t.start_date <= today && t.end_date >= today) ??
      [...trips].sort((a, b) => b.start_date.localeCompare(a.start_date))[0]
    );
  }
  const n = normalise(ref);
  return trips.find((t) => t.id === ref) ?? trips.find((t) => normalise(t.name) === n) ?? trips.find((t) => normalise(t.name).includes(n));
}

/** Trip dashboard: total vs budget, per day, by category, pace. All maths in cents. */
export async function tripSummary(store: Store, tripId: string, today = todayLocal()) {
  const [trips, cats, allTxns, links] = await Promise.all([
    store.select("trips"),
    store.select("categories"),
    store.select("transactions"),
    loadLinkTotals(store),
  ]);
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) throw new UserError("Trip not found");
  const overrides = await store.select("trip_transactions");
  const membership = computeMembership(trips, overrides, allTxns, cats);
  const members = applyNet(allTxns.filter((t) => membership.get(t.id) === trip.id), links);
  const spend = (t: Transaction): Cents => {
    const root = rootOf(cats, t.category_id);
    if (t.is_transfer || t.removed_at || root?.kind === "income" || root?.kind === "transfer") return 0;
    if (!root) return t.amount < 0 ? -toCents(t.amount) : 0;
    return -toCents(t.amount);
  };
  const byDay = new Map<string, Cents>();
  const byCat = new Map<string, Cents>();
  let total: Cents = 0;
  for (const t of members) {
    const s = spend(t);
    total += s;
    byDay.set(t.local_date, (byDay.get(t.local_date) ?? 0) + s);
    const label = rootOf(cats, t.category_id)?.name ?? "Uncategorised";
    byCat.set(label, (byCat.get(label) ?? 0) + s);
  }
  const totalDays = daysBetween(trip.start_date, trip.end_date) + 1;
  const status = today < trip.start_date ? "upcoming" : today > trip.end_date ? "finished" : "active";
  const daysElapsed = status === "upcoming" ? 0 : status === "finished" ? totalDays : daysBetween(trip.start_date, today) + 1;
  const daysLeft = totalDays - daysElapsed + (status === "active" ? 1 : 0); // include today while active
  const budget = trip.budget == null ? null : toCents(trip.budget);
  const remaining = budget == null ? null : budget - total;
  return {
    trip,
    status,
    total_days: totalDays,
    days_elapsed: daysElapsed,
    days_left: Math.max(0, daysLeft),
    spent: fromCents(total),
    budget: budget == null ? null : fromCents(budget),
    remaining: remaining == null ? null : fromCents(remaining),
    daily_average: daysElapsed ? fromCents(Math.round(total / daysElapsed)) : 0,
    remaining_per_day: remaining == null || daysLeft <= 0 ? null : fromCents(Math.round(remaining / Math.max(1, daysLeft))),
    by_day: eachDay(trip.start_date, trip.end_date).map((d) => ({ date: d, spent: fromCents(byDay.get(d) ?? 0) })),
    by_category: [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([name, c]) => ({ name, spent: fromCents(c) })),
    transactions: members
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((t) => ({
        id: t.id,
        local_date: t.local_date,
        description: t.merchant_name ?? t.description,
        amount: t.amount,
        foreign_amount: t.foreign_amount,
        foreign_currency: t.foreign_currency,
        category: categoryLabel(cats, t.category_id),
        manual: overrides.some((o) => o.transaction_id === t.id && o.mode === "include"),
      })),
  };
}

export async function listTrips(store: Store) {
  const trips = await store.select("trips", undefined, { order: { column: "start_date", ascending: false } });
  return Promise.all(trips.map(async (t) => {
    const s = await tripSummary(store, t.id);
    return { ...t, status: s.status, spent: s.spent, remaining: s.remaining, days_left: s.days_left };
  }));
}

import { withStore } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Pending (not yet settled) transactions, newest first. Not counted in totals. */
export const GET = () =>
  withStore(async (store) => (await store.select("pending_transactions")).sort((a, b) => b.date.localeCompare(a.date)));

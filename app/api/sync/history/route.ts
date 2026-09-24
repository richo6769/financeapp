import { withStore } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = () =>
  withStore(async (store) => ({
    runs: await store.select("sync_log", undefined, { order: { column: "started_at", ascending: false }, limit: 20 }),
    accounts: await store.select("accounts", undefined, { order: { column: "name" } }),
  }));

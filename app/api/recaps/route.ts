import { withStore } from "@/lib/api";
import { generateRecap } from "@/lib/recap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = () =>
  withStore((store) => store.select("weekly_recaps", undefined, { order: { column: "week_start", ascending: false }, limit: 52 }));

/** Regenerate last week's recap now (the cron does this every Monday). */
export const POST = () => withStore((store) => generateRecap(store, { force: true }));

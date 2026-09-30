import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getOwnerStore } from "@/lib/store";
import { getAkahuClient } from "@/lib/akahu";
import { runSync } from "@/lib/sync";
import { maybeGenerateWeeklyRecap } from "@/lib/recap";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  if (!env.cronSecret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.cronSecret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily Vercel cron (see vercel.json; 17:00 UTC = 5–6am NZ). Syncs the
 * owner's data only, then on Mondays (NZ) writes last week's recap. Vercel
 * sends `Authorization: Bearer $CRON_SECRET` automatically.
 */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const store = await getOwnerStore();
    const log = await runSync(store, getAkahuClient(), "cron");
    let recap: string | null = null;
    try {
      const r = await maybeGenerateWeeklyRecap(store);
      recap = r ? `recap for week of ${r.week_start} (${r.generated_by})` : null;
    } catch (err) {
      recap = `recap failed: ${err instanceof Error ? err.message : err}`;
    }
    return NextResponse.json({ sync: log, recap }, { status: log.status === "success" ? 200 : 500 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

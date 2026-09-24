import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getOwnerStore } from "@/lib/store";
import { getAkahuClient } from "@/lib/akahu";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily Vercel cron (see vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
 */
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const store = await getOwnerStore();
    const log = await runSync(store, getAkahuClient(), "cron");
    return NextResponse.json(log, { status: log.status === "success" ? 200 : 500 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

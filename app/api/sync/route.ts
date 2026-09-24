import { withStore } from "@/lib/api";
import { getAkahuClient } from "@/lib/akahu";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Sync now" button. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const full = new URL(req.url).searchParams.get("full") === "1";
    return runSync(store, getAkahuClient(), "manual", { full });
  });

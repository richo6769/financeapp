import { withStore } from "@/lib/api";
import { dashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/** ?mode=cycle for the pay-cycle view (falls back to month if not set up). */
export const GET = (req: Request) =>
  withStore((store) => dashboard(store, new URL(req.url).searchParams.get("mode") === "cycle" ? "cycle" : "month"));

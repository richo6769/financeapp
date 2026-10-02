import { withStore } from "@/lib/api";
import { budgetOverview } from "@/lib/overview";
import { parseLocalDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** ?mode=month|cycle&at=YYYY-MM-DD (any date in the wanted period; default today). */
export const GET = (req: Request) =>
  withStore(async (store) => {
    const p = new URL(req.url).searchParams;
    let at: string | undefined;
    if (p.get("at")) {
      try {
        at = parseLocalDate(p.get("at")!);
      } catch {
        throw new UserError("at must be YYYY-MM-DD");
      }
    }
    return budgetOverview(store, p.get("mode") === "cycle" ? "cycle" : "month", at);
  });

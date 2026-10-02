import { withStore } from "@/lib/api";
import { dailySpend } from "@/lib/overview";
import { parseLocalDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** ?from=&to= — spend and income per day (Activity calendar). */
export const GET = (req: Request) =>
  withStore(async (store) => {
    const p = new URL(req.url).searchParams;
    let from: string, to: string;
    try {
      [from, to] = [parseLocalDate(p.get("from") ?? undefined), parseLocalDate(p.get("to") ?? undefined)];
    } catch {
      throw new UserError("Dates must be YYYY-MM-DD");
    }
    return dailySpend(store, from, to);
  });

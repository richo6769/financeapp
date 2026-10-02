import { withStore } from "@/lib/api";
import { insights } from "@/lib/overview";
import { parseLocalDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** ?kind=spending|income&from=&to= — per category, compared with the previous period of the same length. */
export const GET = (req: Request) =>
  withStore(async (store) => {
    const p = new URL(req.url).searchParams;
    let from: string, to: string;
    try {
      [from, to] = [parseLocalDate(p.get("from") ?? undefined), parseLocalDate(p.get("to") ?? undefined)];
    } catch {
      throw new UserError("Dates must be YYYY-MM-DD");
    }
    return insights(store, p.get("kind") === "income" ? "income" : "spending", from, to);
  });

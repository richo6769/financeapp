import { withStore } from "@/lib/api";
import { categoryBreakdown } from "@/lib/services";
import { parseLocalDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** ?category=<id>|uncategorised&from=YYYY-MM-DD&to=YYYY-MM-DD — what makes up a home-page category bar. */
export const GET = (req: Request) =>
  withStore(async (store) => {
    const p = new URL(req.url).searchParams;
    const category = p.get("category");
    const from = p.get("from");
    const to = p.get("to");
    if (!category || !from || !to) throw new UserError("category, from and to are required");
    let f: string, t: string;
    try {
      [f, t] = [parseLocalDate(from), parseLocalDate(to)];
    } catch {
      throw new UserError("Dates must be YYYY-MM-DD");
    }
    return categoryBreakdown(store, category === "uncategorised" ? null : category, f, t);
  });

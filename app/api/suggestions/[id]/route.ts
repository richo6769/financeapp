import { body, withStore } from "@/lib/api";
import { acceptSuggestion, dismissSuggestion } from "@/lib/suggest";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** { action: "accept" | "dismiss" } — accepting is the only way a suggestion becomes a link. */
export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return withStore(async (store) => {
    const { action } = await body<{ action: string }>(req);
    if (action === "accept") return acceptSuggestion(store, id);
    if (action === "dismiss") return dismissSuggestion(store, id);
    throw new UserError("Unknown action");
  });
};

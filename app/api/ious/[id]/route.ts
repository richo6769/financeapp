import { body, withStore } from "@/lib/api";
import { cancelIou, markIouSettled } from "@/lib/iou";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** { action: "cancel" | "settle" } — settle = paid outside the bank (e.g. cash). */
export const PATCH = async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return withStore(async (store) => {
    const { action } = await body<{ action: string }>(req);
    if (action === "cancel") return cancelIou(store, id);
    if (action === "settle") return markIouSettled(store, id);
    throw new UserError("Unknown action");
  });
};

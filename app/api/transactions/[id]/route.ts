import { body, withStore } from "@/lib/api";
import { setTransactionCategory, UserError } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Inline recategorise; `apply_to_merchant` also creates a rule. */
export const PATCH = async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return withStore(async (store) => {
    const b = await body<{ category_id?: string | null; apply_to_merchant?: boolean; notes?: string }>(req);
    if (b.notes !== undefined) await store.update("transactions", { eq: { id } }, { notes: b.notes || null });
    if (b.category_id !== undefined) return setTransactionCategory(store, id, b.category_id, Boolean(b.apply_to_merchant));
    return { ok: true };
  });
};

/** Only manual (cash) transactions can be deleted. */
export const DELETE = async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return withStore(async (store) => {
    const n = await store.remove("transactions", { eq: { id, is_manual: true } });
    if (!n) throw new UserError("Only manual transactions can be deleted");
    return { ok: true };
  });
};

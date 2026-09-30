import { withStore } from "@/lib/api";
import { unlinkReimbursement } from "@/lib/reimburse";

export const dynamic = "force-dynamic";

/** Unlink a reimbursement; the expense goes back to its gross amount. */
export const DELETE = async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return withStore(async (store) => ({ removed: await unlinkReimbursement(store, id) }));
};

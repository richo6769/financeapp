import { withStore } from "@/lib/api";

export const dynamic = "force-dynamic";

export const DELETE = async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return withStore(async (store) => ({ removed: await store.remove("rules", { eq: { id } }) }));
};

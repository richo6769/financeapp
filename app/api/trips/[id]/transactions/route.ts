import { body, withStore } from "@/lib/api";
import { setTripMembership } from "@/lib/trips";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Manually add ("include"), remove ("exclude") or reset ("auto") a transaction. */
export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return withStore(async (store) => {
    const b = await body<{ transaction_id: string; mode: string }>(req);
    if (!["include", "exclude", "auto"].includes(b.mode)) throw new UserError("mode must be include, exclude or auto");
    await setTripMembership(store, id, String(b.transaction_id ?? ""), b.mode as "include" | "exclude" | "auto");
    return { ok: true };
  });
};

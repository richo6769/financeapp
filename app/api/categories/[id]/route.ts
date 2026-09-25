import { body, withStore } from "@/lib/api";
import { deleteCategory, updateCategory } from "@/lib/services";
import type { CategoryKind } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return withStore(async (store) => {
    const b = await body<{ name?: string; parent_id?: string | null; kind?: CategoryKind; color?: string }>(req);
    return updateCategory(store, id, { name: b.name, parent: b.parent_id, kind: b.kind, color: b.color });
  });
};

/** Without ?confirm=1 returns a preview of what would be affected. */
export const DELETE = async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const confirmed = new URL(req.url).searchParams.get("confirm") === "1";
  return withStore((store) => deleteCategory(store, id, { confirmed }));
};

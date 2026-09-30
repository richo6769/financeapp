import { body, withStore } from "@/lib/api";
import { deleteTrip, tripSummary, updateTrip } from "@/lib/trips";
import { parseLocalDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return withStore((store) => tripSummary(store, id));
};

export const PATCH = async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return withStore(async (store) => {
    const b = await body<Record<string, unknown>>(req);
    const patch: Parameters<typeof updateTrip>[2] = {};
    if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 60);
    if (typeof b.start_date === "string") patch.start_date = parseLocalDate(b.start_date);
    if (typeof b.end_date === "string") patch.end_date = parseLocalDate(b.end_date);
    if ("budget" in b) patch.budget = b.budget === null || b.budget === "" ? null : Math.max(0, Number(b.budget));
    if (typeof b.exclude_from_monthly === "boolean") patch.exclude_from_monthly = b.exclude_from_monthly;
    if (typeof b.include_all === "boolean") patch.include_all = b.include_all;
    return updateTrip(store, id, patch);
  });
};

export const DELETE = async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return withStore(async (store) => ({ removed: await deleteTrip(store, id) }));
};

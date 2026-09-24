import { body, withStore } from "@/lib/api";
import { createCategory } from "@/lib/services";
import type { CategoryKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = () =>
  withStore(async (store) => {
    const [categories, budgets, settings] = await Promise.all([
      store.select("categories", undefined, { order: { column: "name" } }),
      store.select("budgets"),
      store.select("settings"),
    ]);
    return { categories, budgets, overall_monthly_cap: settings[0]?.overall_monthly_cap ?? null };
  });

export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ name: string; parent_id?: string | null; kind?: CategoryKind }>(req);
    return createCategory(store, { name: b.name, parent: b.parent_id ?? null, kind: b.kind });
  });

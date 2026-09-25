import { body, withStore } from "@/lib/api";
import { categoryLabel, createRule } from "@/lib/services";
import type { RuleField, RuleMatch } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = () =>
  withStore(async (store) => {
    const [rules, cats] = await Promise.all([
      store.select("rules", undefined, { order: { column: "priority" } }),
      store.select("categories"),
    ]);
    return rules.map((r) => ({ ...r, category_label: categoryLabel(cats, r.category_id) }));
  });

export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{
      pattern: string;
      category_id: string;
      field?: RuleField;
      match_type?: RuleMatch;
      apply_to_existing?: boolean;
      confirmed?: boolean;
    }>(req);
    return createRule(store, { ...b, category: b.category_id });
  });

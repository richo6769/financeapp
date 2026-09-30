import { body, withStore } from "@/lib/api";
import { removeBudget, setBudget, setOverallCap, setSavingsGoal } from "@/lib/services";
import type { BudgetPeriod } from "@/lib/types";

export const dynamic = "force-dynamic";

export const PUT = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ category_id?: string; overall?: boolean; savings_goal?: boolean; amount: number | null; period?: BudgetPeriod }>(req);
    const amount = b.amount === null || (b.amount as unknown) === "" ? null : Number(b.amount);
    if (b.savings_goal) return setSavingsGoal(store, amount, b.period);
    if (b.overall) return setOverallCap(store, amount, b.period);
    if (!b.category_id) return { error: "category_id required" };
    if (amount === null) return { removed: await removeBudget(store, b.category_id) };
    return setBudget(store, { category: b.category_id, amount, period: b.period });
  });

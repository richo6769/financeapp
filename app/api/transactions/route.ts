import { body, withStore } from "@/lib/api";
import { addManualTransaction, categoryLabel, findTransactions } from "@/lib/services";
import { parseLocalDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withStore(async (store) => {
    const p = new URL(req.url).searchParams;
    const limit = Math.min(Number(p.get("limit") ?? 200), 1000);
    const rows = await findTransactions(store, {
      q: p.get("q") || undefined,
      account_id: p.get("account") || undefined,
      category: p.get("category") || undefined,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
    });
    const cats = await store.select("categories");
    return {
      total: rows.length,
      items: rows.slice(0, limit).map((t) => ({ ...t, category_label: categoryLabel(cats, t.category_id) })),
    };
  });

/** Manual (cash) transaction. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ description: string; amount: number; date?: string; category?: string; notes?: string }>(req);
    return addManualTransaction(store, { ...b, amount: Number(b.amount), date: parseLocalDate(b.date) });
  });

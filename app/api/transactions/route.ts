import { body, withStore } from "@/lib/api";
import { addManualTransaction, categoryLabel, findTransactions } from "@/lib/services";
import { parseLocalDate } from "@/lib/dates";
import { describeNet } from "@/lib/reimburse";
import { loadMembership } from "@/lib/trips";
import { balanceCents } from "@/lib/iou";
import { fromCents } from "@/lib/money";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withStore(async (store) => {
    const p = new URL(req.url).searchParams;
    const limit = Math.min(Math.max(1, Number(p.get("limit") ?? 200) || 200), 1000);
    const rows = await findTransactions(store, {
      q: p.get("q")?.slice(0, 100) || undefined,
      account_id: p.get("account") || undefined,
      category: p.get("category") || undefined,
      from: p.get("from") ? parseLocalDate(p.get("from")!) : undefined,
      to: p.get("to") ? parseLocalDate(p.get("to")!) : undefined,
    });
    const visible = p.get("category") === "uncategorised" ? rows.filter((t) => !t.removed_at) : rows;
    const pageRows = visible.slice(0, limit);
    const [cats, page, { trips, membership }, ious] = await Promise.all([
      store.select("categories"),
      describeNet(store, pageRows),
      loadMembership(store),
      pageRows.length ? store.select("ious", { in: { expense_id: pageRows.map((t) => t.id) } }) : Promise.resolve([]),
    ]);
    return {
      total: visible.length,
      items: page.map((t) => {
        const tripId = membership.get(t.id);
        return {
          ...t,
          category_label: categoryLabel(cats, t.category_id),
          trip: tripId ? { id: tripId, name: trips.find((x) => x.id === tripId)?.name ?? "Trip" } : null,
          ious: ious
            .filter((i) => i.expense_id === t.id && i.status !== "cancelled")
            .map((i) => ({ id: i.id, person_name: i.person_name, amount: i.amount, balance: fromCents(balanceCents(i)), status: i.status })),
        };
      }),
    };
  });

/** Manual (cash) transaction. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ description: string; amount: number; date?: string; category?: string; notes?: string }>(req);
    const description = String(b.description ?? "").trim();
    if (!description || description.length > 120) throw new UserError("Description is required (max 120 characters)");
    const amount = Number(b.amount);
    if (!Number.isFinite(amount)) throw new UserError("Amount must be a number");
    return addManualTransaction(store, { description, amount, date: parseLocalDate(b.date), category: b.category || undefined, notes: b.notes?.slice(0, 500) });
  });

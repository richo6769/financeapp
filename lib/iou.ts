import "server-only";
import type { Store } from "@/lib/store/types";
import type { Iou, ReimbursementLink, Transaction } from "@/lib/types";
import { daysBetween, toLocalDate, todayLocal } from "@/lib/dates";
import { formatCents, fromCents, sumCents, toCents, type Cents } from "@/lib/money";
import { normalise } from "@/lib/categorise";
import { UserError } from "@/lib/errors";

/**
 * IOUs: "Sam owes me $100" on an expense. Balance = amount − settled_amount.
 * When a reimbursement link from a payment whose text matches the person is
 * created on that expense, the IOU is (partly) settled automatically; unlinking
 * reverses exactly what that link settled.
 */

export const balanceCents = (i: Pick<Iou, "amount" | "settled_amount">): Cents =>
  toCents(i.amount) - toCents(i.settled_amount);

/** Does this bank text look like it's from `person`? ("Sam" ~ "SAM WILSON", "Sam Wilson" ~ "S WILSON"). */
export function personMatches(person: string, t: Pick<Transaction, "description" | "merchant_name">): boolean {
  const hay = ` ${normalise(t.merchant_name)} ${normalise(t.description)} `;
  const words = normalise(person).split(" ").filter(Boolean);
  if (!words.length) return false;
  if (hay.includes(` ${words.join(" ")} `)) return true;
  // Any name word of 3+ letters as a whole word (surname or first name).
  return words.some((w) => w.length >= 3 && hay.includes(` ${w} `));
}

export async function createIou(
  store: Store,
  input: { expense_id: string; person_name: string; amount?: number },
): Promise<Iou> {
  const person = input.person_name.trim().replace(/\s+/g, " ");
  if (!person) throw new UserError("Who owes you? (person name is required)");
  if (person.length > 60) throw new UserError("Name is too long");
  const [expense] = await store.select("transactions", { eq: { id: input.expense_id } });
  if (!expense) throw new UserError("Expense not found");
  if (expense.amount >= 0) throw new UserError("IOUs can only be added to an expense (money out)");
  const gross = -toCents(expense.amount);
  const amount = input.amount == null ? gross : toCents(input.amount);
  if (!(amount > 0)) throw new UserError("Amount must be more than $0");
  const existing = await store.select("ious", { eq: { expense_id: expense.id } });
  const committed = sumCents(existing.filter((i) => i.status !== "cancelled").map((i) => i.amount));
  if (committed + amount > gross) {
    throw new UserError(`IOUs on this expense would total ${formatCents(committed + amount)}, more than the ${formatCents(gross)} spent`);
  }
  const [iou] = await store.insert("ious", [
    { expense_id: expense.id, person_name: person, amount: fromCents(amount), settled_amount: 0, status: "open", settled_at: null },
  ]);
  return iou;
}

export async function cancelIou(store: Store, id: string): Promise<Iou> {
  const [iou] = await store.select("ious", { eq: { id } });
  if (!iou) throw new UserError("IOU not found");
  if (iou.status === "cancelled") return iou;
  await store.update("ious", { eq: { id } }, { status: "cancelled" });
  return { ...iou, status: "cancelled" };
}

/** Mark paid outside the bank (e.g. cash). */
export async function markIouSettled(store: Store, id: string): Promise<Iou> {
  const [iou] = await store.select("ious", { eq: { id } });
  if (!iou) throw new UserError("IOU not found");
  const patch = { status: "settled" as const, settled_amount: iou.amount, settled_at: new Date().toISOString() };
  await store.update("ious", { eq: { id } }, patch);
  return { ...iou, ...patch };
}

export async function applyLinkToIou(
  store: Store,
  x: { expense: Transaction; income: Transaction; amountCents: Cents; preferIouId?: string | null },
): Promise<{ iouId: string; appliedCents: Cents } | null> {
  const open = (await store.select("ious", { eq: { expense_id: x.expense.id, status: "open" } })).filter((i) => balanceCents(i) > 0);
  if (!open.length) return null;
  const iou = open.find((i) => i.id === x.preferIouId) ?? open.find((i) => personMatches(i.person_name, x.income));
  if (!iou) return null;
  const applied = Math.min(x.amountCents, balanceCents(iou));
  const settled = toCents(iou.settled_amount) + applied;
  const done = settled >= toCents(iou.amount);
  await store.update(
    "ious",
    { eq: { id: iou.id } },
    { settled_amount: fromCents(settled), status: done ? "settled" : "open", settled_at: done ? new Date().toISOString() : null },
  );
  return { iouId: iou.id, appliedCents: applied };
}

export async function reverseIouForLink(store: Store, link: ReimbursementLink): Promise<void> {
  if (!link.iou_id || !(toCents(link.iou_amount) > 0)) return;
  const [iou] = await store.select("ious", { eq: { id: link.iou_id } });
  if (!iou) return;
  const settled = Math.max(0, toCents(iou.settled_amount) - toCents(link.iou_amount));
  await store.update(
    "ious",
    { eq: { id: iou.id } },
    {
      settled_amount: fromCents(settled),
      status: iou.status === "cancelled" ? "cancelled" : "open",
      settled_at: null,
    },
  );
}

export interface IouView extends Iou {
  balance: number;
  age_days: number;
  expense: { id: string; date: string; description: string; amount: number } | null;
}

export async function listIous(store: Store, opts: { status?: Iou["status"] | "all"; person?: string } = {}): Promise<IouView[]> {
  const status = opts.status ?? "open";
  const rows = await store.select("ious", status === "all" ? undefined : { eq: { status } }, { order: { column: "created_at", ascending: true } });
  const filtered = opts.person ? rows.filter((i) => personMatches(opts.person!, { description: i.person_name, merchant_name: null }) || normalise(i.person_name).includes(normalise(opts.person!))) : rows;
  const expenses = filtered.length ? await store.select("transactions", { in: { id: [...new Set(filtered.map((i) => i.expense_id))] } }) : [];
  const today = todayLocal();
  return filtered.map((i) => {
    const e = expenses.find((x) => x.id === i.expense_id);
    return {
      ...i,
      balance: fromCents(balanceCents(i)),
      age_days: Math.max(0, daysBetween(toLocalDate(i.created_at), today)),
      expense: e ? { id: e.id, date: e.local_date, description: e.merchant_name ?? e.description, amount: e.amount } : null,
    };
  });
}

/** "Owed to me": open IOUs grouped by person (names compared case-insensitively). */
export async function owedByPerson(store: Store) {
  const ious = await listIous(store, { status: "open" });
  const groups = new Map<string, { person: string; total: Cents; oldest_days: number; ious: IouView[] }>();
  for (const i of ious) {
    const key = normalise(i.person_name);
    const g = groups.get(key) ?? { person: i.person_name, total: 0, oldest_days: 0, ious: [] };
    g.total += balanceCents(i);
    g.oldest_days = Math.max(g.oldest_days, i.age_days);
    g.ious.push(i);
    groups.set(key, g);
  }
  const people = [...groups.values()].sort((a, b) => b.total - a.total);
  return {
    total: fromCents(people.reduce((a, g) => a + g.total, 0)),
    people: people.map((g) => ({ ...g, total: fromCents(g.total) })),
  };
}

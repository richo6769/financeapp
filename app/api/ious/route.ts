import { body, withStore } from "@/lib/api";
import { createIou, listIous, owedByPerson } from "@/lib/iou";

export const dynamic = "force-dynamic";

/** "Owed to me": open IOUs grouped by person, plus recent settled/cancelled. */
export const GET = () =>
  withStore(async (store) => ({
    ...(await owedByPerson(store)),
    closed: (await listIous(store, { status: "all" })).filter((i) => i.status !== "open").slice(-20).reverse(),
  }));

export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ expense_id: string; person_name: string; amount?: number | string | null }>(req);
    const amount = b.amount === undefined || b.amount === null || b.amount === "" ? undefined : Number(b.amount);
    return createIou(store, { expense_id: String(b.expense_id ?? ""), person_name: String(b.person_name ?? ""), amount });
  });

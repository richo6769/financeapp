import { body, withStore } from "@/lib/api";
import { linkReimbursement } from "@/lib/reimburse";

export const dynamic = "force-dynamic";

/** Net off: link (part of) an incoming payment to an expense. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ expense_id: string; income_id: string; amount?: number | string | null }>(req);
    const amount = b.amount === undefined || b.amount === null || b.amount === "" ? undefined : Number(b.amount);
    return linkReimbursement(store, { expense_id: b.expense_id, income_id: b.income_id, amount });
  });

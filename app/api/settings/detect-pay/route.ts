import { withStore } from "@/lib/api";
import { detectPayCycle } from "@/lib/paycycle";

export const dynamic = "force-dynamic";

/** Suggest pay frequency + next payday from Salary-category credits (not saved). */
export const GET = () => withStore(async (store) => (await detectPayCycle(store)) ?? { frequency: null });

import { body, withStore } from "@/lib/api";
import { currentCycle, savePayCycle } from "@/lib/paycycle";
import { parseLocalDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import type { PayFrequency } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = () =>
  withStore(async (store) => {
    const [settings] = await store.select("settings");
    return {
      pay_frequency: settings?.pay_frequency ?? null,
      next_payday: settings?.next_payday ?? null,
      overall_monthly_cap: settings?.overall_monthly_cap ?? null,
      cycle: currentCycle(settings),
    };
  });

export const PUT = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ pay_frequency: string | null; next_payday?: string | null }>(req);
    const f = b.pay_frequency || null;
    if (f && !["weekly", "fortnightly", "monthly"].includes(f)) throw new UserError("Pay frequency must be weekly, fortnightly or monthly");
    if (f && !b.next_payday) throw new UserError("Next payday is required");
    await savePayCycle(store, f as PayFrequency | null, f ? parseLocalDate(b.next_payday!) : null);
    const [settings] = await store.select("settings");
    return { ok: true, cycle: currentCycle(settings) };
  });

import { body, withStore } from "@/lib/api";
import { createTrip, listTrips } from "@/lib/trips";
import { parseLocalDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const GET = () => withStore((store) => listTrips(store));

export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ name: string; start_date: string; end_date: string; budget?: number | string | null; exclude_from_monthly?: boolean; include_all?: boolean }>(req);
    return createTrip(store, {
      name: String(b.name ?? ""),
      start_date: parseLocalDate(b.start_date),
      end_date: parseLocalDate(b.end_date),
      budget: b.budget === undefined || b.budget === null || b.budget === "" ? null : Number(b.budget),
      exclude_from_monthly: b.exclude_from_monthly,
      include_all: b.include_all,
    });
  });

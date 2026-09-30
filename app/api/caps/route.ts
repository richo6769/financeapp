import { body, withStore } from "@/lib/api";
import { setWeeklyCap, weeklyCapStatus } from "@/lib/caps";

export const dynamic = "force-dynamic";

export const GET = () =>
  withStore(async (store) => ({ ...(await weeklyCapStatus(store)), all: await store.select("weekly_caps") }));

export const PUT = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ category_id: string; amount: number | string | null }>(req);
    const amount = b.amount === null || b.amount === "" || b.amount === undefined ? null : Number(b.amount);
    return setWeeklyCap(store, String(b.category_id ?? ""), amount);
  });

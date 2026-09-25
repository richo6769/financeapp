import { body, withStore } from "@/lib/api";
import { listSubscriptions, setSubscriptionIgnored } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export const GET = () => withStore((store) => listSubscriptions(store));

/** { key, ignored } — "not a subscription" is remembered. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ key: string; ignored: boolean }>(req);
    return setSubscriptionIgnored(store, String(b.key ?? ""), Boolean(b.ignored));
  });

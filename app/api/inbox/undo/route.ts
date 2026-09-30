import { body, withStore } from "@/lib/api";
import { undoCategorise } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/** { undo } — the token returned by a save; puts transactions and rules back. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ undo?: unknown }>(req);
    return undoCategorise(store, b.undo);
  });

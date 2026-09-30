import { body, withStore } from "@/lib/api";
import { guessCategories } from "@/lib/inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Guess a category for each group. Nothing is saved. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ keys?: unknown }>(req).catch(() => ({ keys: undefined }));
    const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string").slice(0, 300) : undefined;
    return guessCategories(store, keys);
  });

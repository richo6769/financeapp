import { body, withStore } from "@/lib/api";
import { dismissGuess, guessCategories } from "@/lib/inbox";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Guess (or re-guess) a category for each group and remember it. Nothing is applied. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ keys?: unknown }>(req).catch(() => ({ keys: undefined }));
    const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string").slice(0, 300) : undefined;
    return guessCategories(store, { keys });
  });

/** { key } — "not this": drop the guess and don't guess this group again. */
export const DELETE = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ key?: unknown }>(req);
    if (typeof b.key !== "string") throw new UserError("key is required");
    await dismissGuess(store, b.key);
    return { ok: true };
  });

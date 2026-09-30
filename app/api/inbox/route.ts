import { body, withStore } from "@/lib/api";
import { categoriseGroups, inboxGroups, quickCategories, storedGuesses } from "@/lib/inbox";
import { UserError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Uncategorised, grouped by merchant, your most-used categories for one-tap picks, and saved guesses. */
export const GET = () =>
  withStore(async (store) => {
    const [groups, quick] = await Promise.all([inboxGroups(store), quickCategories(store)]);
    // Guesses made after the last sync; the inbox still works if the table isn't there yet.
    const guesses = await storedGuesses(store, groups).catch((err) => {
      console.warn("[inbox] couldn't load guesses:", err instanceof Error ? err.message : err);
      return {};
    });
    return { total: groups.reduce((a, g) => a + g.count, 0), groups, quick, guesses };
  });

/** { picks: [{ key, category_id, create_rule }] } — categorise whole groups. */
export const POST = (req: Request) =>
  withStore(async (store) => {
    const b = await body<{ picks?: { key?: unknown; category_id?: unknown; create_rule?: unknown }[] }>(req);
    if (!Array.isArray(b.picks)) throw new UserError("picks is required");
    const picks = b.picks.map((p) => {
      if (typeof p?.key !== "string" || typeof p.category_id !== "string") throw new UserError("Each pick needs a key and category_id");
      return { key: p.key, category_id: p.category_id, create_rule: Boolean(p.create_rule) };
    });
    return categoriseGroups(store, picks);
  });

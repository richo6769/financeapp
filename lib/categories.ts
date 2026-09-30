import type { Category } from "@/lib/types";
import { normalise } from "@/lib/categorise";
import { UserError } from "@/lib/errors";

export function rootOf(cats: Category[], id: string | null): Category | undefined {
  let c = cats.find((x) => x.id === id);
  for (let i = 0; c?.parent_id && i < 5; i++) c = cats.find((x) => x.id === c!.parent_id);
  return c;
}

export function categoryLabel(cats: Category[], id: string | null): string {
  const c = cats.find((x) => x.id === id);
  if (!c) return "Uncategorised";
  const p = c.parent_id ? cats.find((x) => x.id === c.parent_id) : undefined;
  return p ? `${p.name} › ${c.name}` : c.name;
}

/** Resolve a category by id, exact name, "Parent > Child", or loose match. */
export function findCategory(cats: Category[], ref: string | null | undefined): Category | undefined {
  if (!ref) return undefined;
  const byId = cats.find((c) => c.id === ref);
  if (byId) return byId;
  const parts = ref.split(/\s*(?:>|›|\/(?=\s))\s*/);
  if (parts.length === 2) {
    const parent = findCategory(cats.filter((c) => !c.parent_id), parts[0]);
    if (parent) {
      const child = cats.find((c) => c.parent_id === parent.id && normalise(c.name) === normalise(parts[1]));
      if (child) return child;
    }
  }
  const n = normalise(ref);
  return (
    cats.find((c) => normalise(c.name) === n && !c.parent_id) ??
    cats.find((c) => normalise(c.name) === n) ??
    cats.find((c) => normalise(c.name).replaceAll(" ", "") === n.replaceAll(" ", "")) ??
    // Parts of compound names: "fuel" → Transport/Fuel, "health" → Health & Wellness.
    cats.find((c) => !c.parent_id && c.name.split(/\s*[/&]\s*/).some((part) => normalise(part) === n)) ??
    cats.find((c) => !c.parent_id && (normalise(c.name).startsWith(n) || n.startsWith(normalise(c.name))))
  );
}

export function requireCategory(cats: Category[], ref: string): Category {
  const c = findCategory(cats, ref);
  if (!c) {
    throw new UserError(
      `No category called "${ref}". Existing: ${cats.filter((x) => !x.parent_id).map((x) => x.name).join(", ")}`,
    );
  }
  return c;
}

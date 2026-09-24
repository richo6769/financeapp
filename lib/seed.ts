import "server-only";
import type { CategoryKind } from "@/lib/types";
import type { Store } from "@/lib/store/types";

export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; color: string }[] = [
  { name: "Groceries", kind: "expense", color: "#16a34a" },
  { name: "Eating Out", kind: "expense", color: "#f97316" },
  { name: "Transport", kind: "expense", color: "#0ea5e9" },
  { name: "Fuel", kind: "expense", color: "#eab308" },
  { name: "Rent/Housing", kind: "expense", color: "#8b5cf6" },
  { name: "Utilities", kind: "expense", color: "#06b6d4" },
  { name: "Subscriptions", kind: "expense", color: "#ec4899" },
  { name: "Shopping", kind: "expense", color: "#f43f5e" },
  { name: "Health/Fitness", kind: "expense", color: "#10b981" },
  { name: "Travel", kind: "expense", color: "#3b82f6" },
  { name: "Entertainment", kind: "expense", color: "#a855f7" },
  { name: "Income", kind: "income", color: "#22c55e" },
  { name: "Transfers", kind: "transfer", color: "#64748b" },
  { name: "Other", kind: "expense", color: "#94a3b8" },
];

/** Starter rules for common NZ merchants (the user can edit/delete them). */
export const DEFAULT_RULES: { pattern: string; category: string }[] = [
  { pattern: "countdown", category: "Groceries" },
  { pattern: "woolworths", category: "Groceries" },
  { pattern: "new world", category: "Groceries" },
  { pattern: "pak n save", category: "Groceries" },
  { pattern: "paknsave", category: "Groceries" },
  { pattern: "uber eats", category: "Eating Out" },
  { pattern: "z energy", category: "Fuel" },
  { pattern: "bp connect", category: "Fuel" },
  { pattern: "netflix", category: "Subscriptions" },
  { pattern: "spotify", category: "Subscriptions" },
];

const seeded = new Set<string>();

/** Idempotently seed default categories + starter rules for a user. */
export async function ensureSeeded(store: Store): Promise<void> {
  const key = `${store.kind}:${store.userId}`;
  if (seeded.has(key)) return;
  const existing = await store.select("categories", undefined, { limit: 1 });
  if (existing.length === 0) {
    const cats = await store.insert(
      "categories",
      DEFAULT_CATEGORIES.map((c) => ({
        name: c.name,
        kind: c.kind,
        color: c.color,
        parent_id: null,
        is_system: c.name === "Transfers" || c.name === "Income",
      })),
    );
    const byName = new Map(cats.map((c) => [c.name, c.id]));
    await store.insert(
      "rules",
      DEFAULT_RULES.map((r, i) => ({
        pattern: r.pattern,
        field: "any" as const,
        match_type: "contains" as const,
        category_id: byName.get(r.category)!,
        priority: 100 + i,
      })),
    );
  }
  seeded.add(key);
}

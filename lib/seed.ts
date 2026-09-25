import "server-only";
import type { CategoryKind } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { defaultMatchType } from "@/lib/categorise";

export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; color: string }[] = [
  { name: "Groceries", kind: "expense", color: "#16a34a" },
  { name: "Eating Out", kind: "expense", color: "#f97316" },
  { name: "Takeaways", kind: "expense", color: "#fb923c" },
  { name: "Bars", kind: "expense", color: "#d97706" },
  { name: "Liquor Stores", kind: "expense", color: "#b45309" },
  { name: "Sports", kind: "expense", color: "#65a30d" },
  { name: "Travel", kind: "expense", color: "#3b82f6" },
  { name: "Entertainment", kind: "expense", color: "#a855f7" },
  { name: "Health & Wellness", kind: "expense", color: "#10b981" },
  { name: "Home Supplies", kind: "expense", color: "#78716c" },
  { name: "Rent", kind: "expense", color: "#8b5cf6" },
  { name: "Transport/Fuel", kind: "expense", color: "#0ea5e9" },
  { name: "Subscriptions", kind: "expense", color: "#ec4899" },
  { name: "Clothes/Shopping", kind: "expense", color: "#f43f5e" },
  { name: "Bills", kind: "expense", color: "#06b6d4" },
  { name: "Insurance", kind: "expense", color: "#6366f1" },
  { name: "Other", kind: "expense", color: "#94a3b8" },
  { name: "Salary", kind: "income", color: "#22c55e" },
  { name: "Transfers", kind: "transfer", color: "#64748b" },
];

/** Categories detection depends on: renameable, not deletable. */
export const SYSTEM_CATEGORIES = ["Salary", "Transfers"];

/**
 * Starter rules for common NZ merchants (editable). Listed in priority order:
 * more specific patterns come first so they win (e.g. "uber eats" before
 * "uber"). Rule priority = 100 + index; lower wins. Keep in sync with
 * supabase/migrations/20260924000100_seed_defaults.sql.
 */
type SeedRule = { pattern: string; category: string };
const RAW_RULES: SeedRule[] = [
  // Takeaways first: "uber eats" must beat Transport/Fuel's "uber".
  ...["uber eats", "doordash", "delivereasy", "mcdonalds", "kfc", "burger king", "dominos", "pizza hut", "subway"].map(
    (pattern) => ({ pattern, category: "Takeaways" }),
  ),
  ...["woolworths", "countdown", "new world", "pak n save", "paknsave", "four square", "freshchoice"].map((pattern) => ({
    pattern,
    category: "Groceries",
  })),
  ...["super liquor", "liquorland", "liquor king", "bottle-o", "glengarry"].map((pattern) => ({
    pattern,
    category: "Liquor Stores",
  })),
  ...["auckland transport", "at hop", "z energy", "bp", "mobil", "gull", "waitomo", "uber"].map((pattern) => ({
    pattern,
    category: "Transport/Fuel",
  })),
  ...["netflix", "spotify", "disney", "neon", "amazon prime", "apple.com"].map((pattern) => ({
    pattern,
    category: "Subscriptions",
  })),
  ...["chemist warehouse", "unichem", "life pharmacy", "les mills", "cityfitness", "snap fitness", "anytime fitness"].map(
    (pattern) => ({ pattern, category: "Health & Wellness" }),
  ),
  ...["bunnings", "mitre 10", "briscoes"].map((pattern) => ({ pattern, category: "Home Supplies" })),
  ...["kmart", "the warehouse", "farmers", "hallenstein"].map((pattern) => ({ pattern, category: "Clothes/Shopping" })),
  ...["spark", "one nz", "2degrees", "mercury", "genesis", "contact energy", "watercare"].map((pattern) => ({
    pattern,
    category: "Bills",
  })),
  ...["aa insurance", "southern cross", "state insurance", "tower", "ami"].map((pattern) => ({
    pattern,
    category: "Insurance",
  })),
  ...["air new zealand", "jetstar", "booking.com", "airbnb", "agoda"].map((pattern) => ({ pattern, category: "Travel" })),
  ...["event cinemas", "hoyts", "ticketmaster"].map((pattern) => ({ pattern, category: "Entertainment" })),
  ...["deloitte", "zuru"].map((pattern) => ({ pattern, category: "Salary" })),
];

/** Words that veto a match, e.g. "SKY TOWER" isn't Tower Insurance. */
const EXCLUDES: Record<string, string> = {
  tower: "sky",
  farmers: "market,markets",
};

/**
 * Whole-word matching for patterns of ≤5 characters and ones that often
 * appear inside other words; substring ("contains") for everything else.
 */
export const DEFAULT_RULES: (SeedRule & { match_type: "word" | "contains"; exclude_words: string | null })[] =
  RAW_RULES.map((r) => ({ ...r, match_type: defaultMatchType(r.pattern), exclude_words: EXCLUDES[r.pattern] ?? null }));

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
        is_system: SYSTEM_CATEGORIES.includes(c.name),
      })),
    );
    const byName = new Map(cats.map((c) => [c.name, c.id]));
    await store.insert(
      "rules",
      DEFAULT_RULES.map((r, i) => ({
        pattern: r.pattern,
        field: "any" as const,
        match_type: r.match_type,
        exclude_words: r.exclude_words,
        category_id: byName.get(r.category)!,
        priority: 100 + i,
      })),
    );
  }
  seeded.add(key);
}

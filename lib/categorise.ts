import type { Account, Category, CategorySource, Rule, Transaction } from "@/lib/types";

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalise(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Matchable = Pick<Transaction, "description" | "merchant_name">;

export function ruleMatches(rule: Pick<Rule, "pattern" | "field" | "match_type">, t: Matchable): boolean {
  const texts =
    rule.field === "merchant"
      ? [t.merchant_name]
      : rule.field === "description"
        ? [t.description]
        : [t.merchant_name, t.description];
  for (const raw of texts) {
    if (!raw) continue;
    if (rule.match_type === "regex") {
      try {
        if (new RegExp(rule.pattern, "i").test(raw)) return true;
      } catch {
        /* invalid regex never matches */
      }
      continue;
    }
    const text = normalise(raw);
    const pat = normalise(rule.pattern);
    if (!pat) continue;
    if (rule.match_type === "exact") {
      if (text === pat) return true;
      continue;
    }
    // contains: short patterns (e.g. "bp") must match whole words; longer
    // ones match substrings, also ignoring spaces ("paknsave" ~ "pak n save").
    if (pat.length < 4) {
      if (` ${text} `.includes(` ${pat} `)) return true;
    } else if (text.includes(pat) || text.replaceAll(" ", "").includes(pat.replaceAll(" ", ""))) {
      return true;
    }
  }
  return false;
}

/** First matching rule by priority (lower first), then oldest. */
export function findRule(rules: Rule[], t: Matchable): Rule | undefined {
  return [...rules]
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
    .find((r) => ruleMatches(r, t));
}

/**
 * Map Akahu's NZFCC category / personal-finance group onto our categories.
 * Order matters: the first match wins, so specific labels come first
 * (pubs/bars → Bars and fast food/takeaways → Takeaways before Eating Out).
 */
const AKAHU_HINTS: [RegExp, string][] = [
  [/\b(supermarkets?|grocer(y|ies)?)\b/i, "Groceries"],
  [/\b(pubs?|bars?|nightclubs?|taverns?)\b/i, "Bars"],
  [/\b(fast food|takeaways?|food delivery)\b/i, "Takeaways"],
  [/\b(liquor|bottle stores?|wine|beer)\b/i, "Liquor Stores"],
  [/\b(cafes?|restaurants?|coffee shops?|dining)\b/i, "Eating Out"],
  [/\b(fuel|petrol|service stations?|public transport|taxis?|rideshare|parking|tolls?)\b/i, "Transport/Fuel"],
  [/\binsurance\b/i, "Insurance"],
  [/\b(electricity|gas supply|water|telecommunications|internet|mobile phone|utilities)\b/i, "Bills"],
  [/\b(streaming|subscriptions?|software|music)\b/i, "Subscriptions"],
  [/\b(gyms?|fitness|pharmac(y|ies)|chemists?|medical|doctors?|dental|health|hairdress\w*|barbers?|beauty)\b/i, "Health & Wellness"],
  [/\b(sport(s|ing)?( goods)?|golf|outdoor)\b/i, "Sports"],
  [/\b(hardware|home improvement|furniture|homewares?|garden|household)\b/i, "Home Supplies"],
  [/\b(airlines?|hotels?|accommodation|travel)\b/i, "Travel"],
  [/\b(cinemas?|entertainment|events?|tickets?)\b/i, "Entertainment"],
  [/\b(department stores?|clothing|apparel|online shopping|retail|electronics)\b/i, "Clothes/Shopping"],
  [/\b(rent|rental|mortgage)\b/i, "Rent"],
  [/\b(salary|wages?|payroll)\b/i, "Salary"],
];

export function akahuHintCategory(
  categories: Category[],
  akahuCategory: string | null | undefined,
  akahuGroup?: string | null,
): Category | undefined {
  for (const label of [akahuCategory, akahuGroup]) {
    if (!label) continue;
    for (const [re, name] of AKAHU_HINTS) {
      if (re.test(label)) {
        const cat = categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && !c.parent_id);
        if (cat) return cat;
      }
    }
  }
  return undefined;
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Heuristics for money moving between my own accounts:
 *  - Amex/credit-card repayments from ANZ ("AMERICAN EXPRESS ... PAYMENT")
 *  - The matching credit on the card ("PAYMENT RECEIVED - THANK YOU")
 *  - Transfers whose other_account / description references one of my accounts
 */
export function looksLikeTransfer(
  t: Pick<Transaction, "description" | "amount" | "account_id" | "type">,
  accounts: Account[],
  otherAccount?: string | null,
): boolean {
  const acct = accounts.find((a) => a.id === t.account_id);
  const desc = t.description.toLowerCase();
  const isCard = acct?.type === "CREDITCARD";
  if (!isCard && t.amount < 0 && /american express|amex|credit card (re)?payment|card payment/.test(desc)) return true;
  if (isCard && t.amount > 0 && /payment received|thank you|payment - thank|direct debit payment|autopay/.test(desc)) return true;
  const own = accounts
    .filter((a) => a.id !== t.account_id && a.formatted_account)
    .map((a) => digits(a.formatted_account!))
    .filter((d) => d.length >= 8);
  if (otherAccount && own.includes(digits(otherAccount))) return true;
  const descDigits = digits(t.description);
  if (descDigits.length >= 8 && own.some((d) => descDigits.includes(d))) return true;
  return false;
}

/**
 * Pair opposite-signed equal amounts on two different own accounts within
 * 3 days (e.g. ANZ -> savings). Only considers rows not manually categorised.
 * Returns the ids of rows that are one leg of such a pair.
 */
export function pairTransfers(
  txns: Pick<Transaction, "id" | "account_id" | "amount" | "local_date" | "category_source" | "type">[],
): Set<string> {
  const out = new Set<string>();
  const candidates = txns.filter(
    (t) => t.category_source !== "manual" && t.account_id && /transfer|payment/i.test(t.type ?? ""),
  );
  const byAmount = new Map<number, typeof candidates>();
  for (const t of candidates) {
    const k = Math.round(Math.abs(t.amount) * 100);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k)!.push(t);
  }
  for (const group of byAmount.values()) {
    const debits = group.filter((t) => t.amount < 0);
    const credits = group.filter((t) => t.amount > 0 && !out.has(t.id));
    for (const d of debits) {
      const match = credits.find(
        (c) =>
          !out.has(c.id) &&
          c.account_id !== d.account_id &&
          Math.abs(Date.parse(c.local_date) - Date.parse(d.local_date)) <= 3 * 86_400_000,
      );
      if (match) {
        out.add(d.id);
        out.add(match.id);
      }
    }
  }
  return out;
}

export interface CategoriseContext {
  categories: Category[];
  rules: Rule[];
  accounts: Account[];
  /** normalised merchant name -> category id from prior manual/rule decisions */
  merchantMemory: Map<string, string>;
}

export interface CategoriseInput extends Matchable {
  amount: number;
  account_id: string | null;
  type: string | null;
  akahu_category: string | null;
  akahu_group?: string | null;
  other_account?: string | null;
}

/**
 * Decide a category. Precedence (my choices always beat Akahu's):
 *  rules > own-account transfer detection > merchant memory > Akahu hint.
 * (Manually categorised rows are never passed through here.)
 */
export function categorise(
  t: CategoriseInput,
  ctx: CategoriseContext,
): { category_id: string | null; category_source: CategorySource; is_transfer: boolean } {
  const kindOf = (id: string | null) => ctx.categories.find((c) => c.id === id)?.kind;
  const rule = findRule(ctx.rules, t);
  if (rule) {
    return { category_id: rule.category_id, category_source: "rule", is_transfer: kindOf(rule.category_id) === "transfer" };
  }
  if (looksLikeTransfer(t, ctx.accounts, t.other_account)) {
    const transfers = ctx.categories.find((c) => c.kind === "transfer" && !c.parent_id);
    return { category_id: transfers?.id ?? null, category_source: "transfer", is_transfer: true };
  }
  const mem = t.merchant_name ? ctx.merchantMemory.get(normalise(t.merchant_name)) : undefined;
  if (mem && ctx.categories.some((c) => c.id === mem)) {
    return { category_id: mem, category_source: "merchant", is_transfer: kindOf(mem) === "transfer" };
  }
  const hint = akahuHintCategory(ctx.categories, t.akahu_category, t.akahu_group);
  if (hint) return { category_id: hint.id, category_source: "akahu", is_transfer: hint.kind === "transfer" };
  if (t.amount > 0 && /\b(salary|wages?|payroll)\b/i.test(t.description)) {
    const income = ctx.categories.find((c) => c.kind === "income" && !c.parent_id);
    if (income) return { category_id: income.id, category_source: "akahu", is_transfer: false };
  }
  return { category_id: null, category_source: null, is_transfer: false };
}

export function buildMerchantMemory(txns: Transaction[]): Map<string, string> {
  const mem = new Map<string, string>();
  const sorted = txns
    .filter((t) => t.merchant_name && t.category_id && (t.category_source === "manual" || t.category_source === "rule"))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) mem.set(normalise(t.merchant_name), t.category_id!);
  return mem;
}

/** A short, human-friendly pattern for "apply to all from this merchant". */
export function merchantPattern(t: Pick<Transaction, "merchant_name" | "description">): {
  pattern: string;
  field: "merchant" | "description";
} {
  if (t.merchant_name) return { pattern: t.merchant_name, field: "merchant" };
  // Drop trailing branch/location noise: keep the first 2-3 meaningful words.
  const words = normalise(t.description)
    .split(" ")
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !["sq", "pos", "eftpos", "ltd", "limited"].includes(w));
  return { pattern: words.slice(0, words.length > 3 ? 2 : 3).join(" ") || t.description, field: "description" };
}

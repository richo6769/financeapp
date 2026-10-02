import "server-only";
import type { Filter, Store } from "@/lib/store/types";
import type {
  Budget,
  BudgetPeriod,
  Category,
  CategoryKind,
  Rule,
  RuleField,
  RuleMatch,
  Transaction,
} from "@/lib/types";
import {
  addDays,
  addMonths,
  daysBetween,
  localDateToIso,
  monthEnd,
  monthKey,
  monthLabel,
  monthProgress,
  monthStart,
  todayLocal,
} from "@/lib/dates";
import { fromCents, monthlyToCycleCents, mulDiv, sumCents, toCents, toMonthly, type Cents } from "@/lib/money";
import { currentCycle } from "@/lib/paycycle";
import { monthlyExclusions } from "@/lib/trips";
import { defaultMatchType, merchantPattern, normalise, ruleMatches, unsafeRegexReason } from "@/lib/categorise";
import { applyNet, loadLinkTotals, needsCategory } from "@/lib/reimburse";

export const BULK_CONFIRM_THRESHOLD = 20;

export { UserError } from "@/lib/errors";
import { UserError } from "@/lib/errors";
export { rootOf, categoryLabel, findCategory, requireCategory, isInternalKind } from "@/lib/categories";
import { rootOf, categoryLabel, findCategory, requireCategory, isInternalKind } from "@/lib/categories";

// ---------------------------------------------------------------- categories

export async function createCategory(
  store: Store,
  input: { name: string; parent?: string | null; kind?: CategoryKind; color?: string | null },
): Promise<Category> {
  const cats = await store.select("categories");
  const name = String(input.name ?? "").trim();
  if (!name) throw new UserError("Category name is required");
  if (name.length > 60) throw new UserError("Category name is too long (max 60 characters)");
  const parent = input.parent ? requireCategory(cats, input.parent) : undefined;
  if (parent?.parent_id) throw new UserError("Subcategories can only be one level deep");
  const dupe = cats.find(
    (c) => normalise(c.name) === normalise(name) && (c.parent_id ?? null) === (parent?.id ?? null),
  );
  if (dupe) return dupe;
  const [created] = await store.insert("categories", [
    {
      name,
      parent_id: parent?.id ?? null,
      kind: input.kind ?? parent?.kind ?? "expense",
      color: input.color ?? null,
      is_system: false,
    },
  ]);
  return created;
}

export async function updateCategory(
  store: Store,
  ref: string,
  patch: { name?: string; parent?: string | null; kind?: CategoryKind; color?: string | null },
): Promise<Category> {
  const cats = await store.select("categories");
  const cat = requireCategory(cats, ref);
  const next: Partial<Category> = {};
  if (patch.name?.trim()) {
    if (patch.name.trim().length > 60) throw new UserError("Category name is too long (max 60 characters)");
    next.name = patch.name.trim();
  }
  if (patch.kind) next.kind = patch.kind;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.parent !== undefined) {
    if (patch.parent === null || patch.parent === "") next.parent_id = null;
    else {
      const parent = requireCategory(cats, patch.parent);
      if (parent.id === cat.id || parent.parent_id) throw new UserError("Invalid parent category");
      if (cats.some((c) => c.parent_id === cat.id)) throw new UserError("A category with subcategories can't become a subcategory");
      next.parent_id = parent.id;
    }
  }
  await store.update("categories", { eq: { id: cat.id } }, next);
  return { ...cat, ...next };
}

export interface DeletePreview {
  category: string;
  subcategories: string[];
  transactions_affected: number;
  rules_removed: number;
  budgets_removed: number;
}

/** Delete a category (+ its subcategories). Transactions become uncategorised. */
export async function deleteCategory(
  store: Store,
  ref: string,
  opts: { confirmed: boolean },
): Promise<{ deleted: boolean; preview: DeletePreview }> {
  const cats = await store.select("categories");
  const cat = requireCategory(cats, ref);
  if (cat.is_system) throw new UserError(`"${cat.name}" is a system category used for transfer/income detection and can't be deleted (you can rename it).`);
  const subs = cats.filter((c) => c.parent_id === cat.id);
  const ids = [cat.id, ...subs.map((s) => s.id)];
  const [txns, rules, budgets] = await Promise.all([
    store.select("transactions", { in: { category_id: ids } }),
    store.select("rules", { in: { category_id: ids } }),
    store.select("budgets", { in: { category_id: ids } }),
  ]);
  const preview: DeletePreview = {
    category: cat.name,
    subcategories: subs.map((s) => s.name),
    transactions_affected: txns.length,
    rules_removed: rules.length,
    budgets_removed: budgets.length,
  };
  if (!opts.confirmed) return { deleted: false, preview };
  await store.update(
    "transactions",
    { in: { category_id: ids } },
    { category_id: null, category_source: null, is_transfer: false },
  );
  await store.remove("rules", { in: { category_id: ids } });
  await store.remove("budgets", { in: { category_id: ids } });
  await store.remove("categories", { in: { id: subs.map((s) => s.id) } });
  await store.remove("categories", { eq: { id: cat.id } });
  return { deleted: true, preview };
}

// ------------------------------------------------------------------- budgets

export async function setBudget(
  store: Store,
  input: { category: string; amount: number; period?: BudgetPeriod },
): Promise<{ budget: Budget; category: string; explanation: string }> {
  if (!(input.amount >= 0)) throw new UserError("Budget amount must be zero or more");
  const cats = await store.select("categories");
  const cat = requireCategory(cats, input.category);
  if (rootOf(cats, cat.id)?.kind !== "expense") {
    throw new UserError(
      rootOf(cats, cat.id)?.kind === "savings"
        ? "Savings isn't spending — set a savings goal instead."
        : `Budgets are for spending categories; "${cat.name}" is ${rootOf(cats, cat.id)?.kind}.`,
    );
  }
  const period = input.period ?? "monthly";
  const { monthly, explanation } = toMonthly(input.amount, period);
  const [budget] = await store.upsert(
    "budgets",
    [{ category_id: cat.id, amount_monthly: monthly, period, period_amount: fromCents(toCents(input.amount)) }],
    "user_id,category_id",
  );
  return { budget, category: categoryLabel(cats, cat.id), explanation };
}

export async function removeBudget(store: Store, categoryRef: string): Promise<number> {
  const cats = await store.select("categories");
  const cat = requireCategory(cats, categoryRef);
  return store.remove("budgets", { eq: { category_id: cat.id } });
}

/** Optional monthly savings goal (weekly/fortnightly/yearly converted to monthly). */
export async function setSavingsGoal(
  store: Store,
  amount: number | null,
  period: BudgetPeriod = "monthly",
): Promise<{ monthly: number | null; explanation: string }> {
  if (amount != null && !(amount >= 0 && amount <= 10_000_000)) throw new UserError("Savings goal must be $0 or more");
  const conv = amount == null ? { monthly: null, explanation: "Savings goal removed" } : toMonthly(amount, period);
  await store.upsert("settings", [{ monthly_savings_goal: conv.monthly }], "user_id");
  return conv;
}

export async function setOverallCap(
  store: Store,
  amount: number | null,
  period: BudgetPeriod = "monthly",
): Promise<{ monthly: number | null; explanation: string }> {
  const conv = amount == null ? { monthly: null, explanation: "Overall cap removed" } : toMonthly(amount, period);
  await store.upsert("settings", [{ overall_monthly_cap: conv.monthly }], "user_id");
  return conv;
}

// --------------------------------------------------------------------- rules

export async function createRule(
  store: Store,
  input: {
    pattern: string;
    category: string;
    field?: RuleField;
    match_type?: RuleMatch;
    exclude_words?: string | null;
    apply_to_existing?: boolean;
    confirmed?: boolean;
  },
): Promise<{ rule: Rule | null; category: string; matched_existing: number; applied: number; needs_confirmation: boolean }> {
  const pattern = input.pattern.trim();
  if (!pattern) throw new UserError("Rule pattern is required");
  if (pattern.length > 100) throw new UserError("Rule pattern is too long (max 100 characters)");
  if (input.match_type === "regex") {
    const why = unsafeRegexReason(pattern);
    if (why) throw new UserError(why);
  }
  const cats = await store.select("categories");
  const cat = requireCategory(cats, input.category);
  const draft = {
    pattern,
    field: input.field ?? "any",
    match_type: input.match_type ?? defaultMatchType(pattern),
    exclude_words: input.exclude_words?.trim() || null,
  } as const;

  // Which existing (non-manual) transactions would this rule re-categorise?
  const txns = await store.select("transactions");
  const hits = txns.filter(
    (t) => t.category_source !== "manual" && t.category_id !== cat.id && ruleMatches(draft, t),
  );
  const apply = input.apply_to_existing ?? true;
  if (apply && hits.length >= BULK_CONFIRM_THRESHOLD && !input.confirmed) {
    return { rule: null, category: cat.name, matched_existing: hits.length, applied: 0, needs_confirmation: true };
  }
  const existingRules = await store.select("rules");
  const dupe = existingRules.find(
    (r) => normalise(r.pattern) === normalise(pattern) && r.field === draft.field && r.match_type === draft.match_type,
  );
  let rule: Rule;
  if (dupe) {
    await store.update("rules", { eq: { id: dupe.id } }, { category_id: cat.id });
    rule = { ...dupe, category_id: cat.id };
  } else {
    // New rules take precedence over older/default ones.
    const minPriority = Math.min(100, ...existingRules.map((r) => r.priority));
    [rule] = await store.insert("rules", [{ ...draft, category_id: cat.id, priority: minPriority - 1 }]);
  }
  let applied = 0;
  if (apply && hits.length) {
    applied = await store.update(
      "transactions",
      { in: { id: hits.map((h) => h.id) } },
      { category_id: cat.id, category_source: "rule", is_transfer: isInternalKind(cat.kind) },
    );
  }
  return { rule, category: cat.name, matched_existing: hits.length, applied, needs_confirmation: false };
}

// -------------------------------------------------------------- transactions

export interface TxnFilter {
  q?: string; // free-text search over description/merchant
  merchant?: string;
  account_id?: string;
  category?: string | "uncategorised";
  from?: string;
  to?: string;
  min_amount?: number; // absolute value bounds
  max_amount?: number;
  direction?: "debit" | "credit";
}

export async function findTransactions(store: Store, f: TxnFilter): Promise<Transaction[]> {
  const cats = await store.select("categories");
  const base: Filter<Transaction> = { gte: {}, lte: {}, eq: {} };
  if (f.from) base.gte!.local_date = f.from;
  if (f.to) base.lte!.local_date = f.to;
  if (f.account_id) base.eq!.account_id = f.account_id;
  let rows = await store.select("transactions", base, { order: { column: "date", ascending: false } });
  if (f.category === "uncategorised") {
    // Fully netted-off incoming payments need no category of their own.
    const totals = await loadLinkTotals(store);
    rows = rows.filter((t) => needsCategory(t, totals));
  }
  else if (f.category) {
    const cat = requireCategory(cats, f.category);
    const ids = new Set([cat.id, ...cats.filter((c) => c.parent_id === cat.id).map((c) => c.id)]);
    rows = rows.filter((t) => t.category_id && ids.has(t.category_id));
  }
  const textMatch = (needle: string, t: Transaction) => {
    const n = normalise(needle);
    const hay = `${normalise(t.merchant_name)} ${normalise(t.description)}`;
    return hay.includes(n) || hay.replaceAll(" ", "").includes(n.replaceAll(" ", ""));
  };
  if (f.merchant) rows = rows.filter((t) => textMatch(f.merchant!, t));
  if (f.q) rows = rows.filter((t) => textMatch(f.q!, t) || (t.notes ?? "").toLowerCase().includes(f.q!.toLowerCase()));
  if (f.min_amount != null) rows = rows.filter((t) => Math.abs(t.amount) >= f.min_amount!);
  if (f.max_amount != null) rows = rows.filter((t) => Math.abs(t.amount) <= f.max_amount!);
  if (f.direction === "debit") rows = rows.filter((t) => t.amount < 0);
  if (f.direction === "credit") rows = rows.filter((t) => t.amount > 0);
  return rows;
}

export async function recategoriseTransactions(
  store: Store,
  filter: TxnFilter,
  targetRef: string,
  opts: { confirmed?: boolean; create_rule?: boolean },
): Promise<{
  matched: number;
  updated: number;
  needs_confirmation: boolean;
  category: string;
  sample: { date: string; description: string; amount: number }[];
  rule_created?: string;
}> {
  if (!filter.merchant && !filter.q && !filter.from && !filter.to && !filter.category && filter.min_amount == null && filter.max_amount == null) {
    throw new UserError("Give at least one filter (merchant, date range, amount or current category)");
  }
  const cats = await store.select("categories");
  const target = requireCategory(cats, targetRef);
  const rows = (await findTransactions(store, filter)).filter((t) => t.category_id !== target.id);
  const sample = rows.slice(0, 5).map((t) => ({ date: t.local_date, description: t.description, amount: t.amount }));
  if (rows.length >= BULK_CONFIRM_THRESHOLD && !opts.confirmed) {
    return { matched: rows.length, updated: 0, needs_confirmation: true, category: target.name, sample };
  }
  const updated = rows.length
    ? await store.update(
        "transactions",
        { in: { id: rows.map((r) => r.id) } },
        { category_id: target.id, category_source: "manual", is_transfer: isInternalKind(target.kind) },
      )
    : 0;
  let rule_created: string | undefined;
  if (opts.create_rule && filter.merchant) {
    const r = await createRule(store, { pattern: filter.merchant, category: target.id, apply_to_existing: false });
    rule_created = r.rule ? `"${r.rule.pattern}" → ${target.name}` : undefined;
  }
  return { matched: rows.length, updated, needs_confirmation: false, category: target.name, sample, rule_created };
}

/** Inline recategorise from the UI, optionally for the whole merchant (+ rule). */
export async function setTransactionCategory(
  store: Store,
  id: string,
  categoryId: string | null,
  applyToMerchant: boolean,
): Promise<{ updated: number; rule?: string }> {
  const [t] = await store.select("transactions", { eq: { id } });
  if (!t) throw new UserError("Transaction not found");
  const cats = await store.select("categories");
  const cat = categoryId ? cats.find((c) => c.id === categoryId) : undefined;
  if (categoryId && !cat) throw new UserError("Category not found");
  await store.update(
    "transactions",
    { eq: { id } },
    {
      category_id: cat?.id ?? null,
      category_source: cat ? "manual" : null,
      is_transfer: isInternalKind(cat?.kind),
    },
  );
  if (!applyToMerchant || !cat) return { updated: 1 };
  const { pattern, field } = merchantPattern(t);
  const res = await createRule(store, { pattern, field, category: cat.id, apply_to_existing: true, confirmed: true });
  return { updated: 1 + res.applied, rule: `"${pattern}" → ${cat.name}` };
}

export async function addManualTransaction(
  store: Store,
  input: { description: string; amount: number; date?: string; category?: string; notes?: string },
): Promise<{ transaction: Transaction; category: string }> {
  const cats = await store.select("categories");
  const cat = input.category ? requireCategory(cats, input.category) : undefined;
  const ld = input.date ?? todayLocal();
  // Positive "spent 40" -> stored as -40 (debit) unless the category is income.
  if (!(Math.abs(input.amount) > 0) || Math.abs(input.amount) > 1_000_000) throw new UserError("Amount must be between $0.01 and $1,000,000");
  const amount = cat?.kind === "income" ? Math.abs(input.amount) : -Math.abs(input.amount);
  const [transaction] = await store.insert("transactions", [
    {
      akahu_id: null,
      account_id: null,
      date: localDateToIso(ld),
      local_date: ld,
      description: input.description,
      merchant_name: null,
      amount: fromCents(toCents(amount)),
      type: "CASH",
      akahu_category: null,
      category_id: cat?.id ?? null,
      category_source: cat ? "manual" : null,
      is_transfer: false,
      is_manual: true,
      notes: input.notes ?? null,
      foreign_amount: null,
      foreign_currency: null,
      removed_at: null,
    },
  ]);
  return { transaction, category: cat ? categoryLabel(cats, cat.id) : "Uncategorised" };
}

// ------------------------------------------------------------------ analytics

/**
 * Spending rules (all maths in integer cents):
 *  - Transfers (own-account moves, card repayments) never count.
 *  - Income categories never count.
 *  - Rows the bank removed after settling never count.
 *  - Expense-category rows count as -amount, so refunds (credits) reduce
 *    spend in their original category. A category can go negative in a month
 *    where refunds exceed purchases; totals keep the true figure and the UI
 *    clamps bars/percentages at zero and labels it "refunds".
 *  - Callers pass NET amounts (see lib/reimburse.ts applyNet), so a $365
 *    expense with $100 paid back by a mate counts as $265.
 *  - Uncategorised debits count as spend (so totals are honest before triage);
 *    uncategorised credits are ignored until categorised.
 */
export function spendCentsOf(t: Transaction, cats: Category[]): Cents {
  if (t.is_transfer || t.removed_at) return 0;
  if (!t.category_id) return t.amount < 0 ? -toCents(t.amount) : 0;
  const root = rootOf(cats, t.category_id);
  if (!root || root.kind !== "expense") return 0;
  return -toCents(t.amount);
}

export function spendOf(t: Transaction, cats: Category[]): number {
  return fromCents(spendCentsOf(t, cats));
}

export interface CategorySpend {
  category_id: string | null;
  name: string;
  color: string | null;
  spent: number;
  budget: number | null;
  remaining: number | null;
  pct: number | null;
  over: boolean;
  /** Refunds exceeded purchases in this period. */
  negative: boolean;
  count: number;
}

export interface SpendOptions {
  includeUnbudgeted?: boolean;
  /** Scale monthly budgets to the period (e.g. pay cycle). Default: as-is. */
  scaleBudget?: (monthlyCents: Cents) => Cents;
  /** Leave out trips marked "exclude from monthly". Default true. */
  excludeTrips?: boolean;
}

export async function spendingByCategory(
  store: Store,
  from: string,
  to: string,
  opts: SpendOptions = {},
): Promise<{
  rows: CategorySpend[];
  total: number;
  income: number;
  trip_excluded: number;
  /** Net moved to savings (Savings-kind categories): out − withdrawals back. */
  saved: number;
  txns: (Transaction & { gross_amount: number })[];
  cats: Category[];
}> {
  const [cats, rawTxns, budgets, links] = await Promise.all([
    store.select("categories"),
    store.select("transactions", { gte: { local_date: from }, lte: { local_date: to } }),
    store.select("budgets"),
    loadLinkTotals(store),
  ]);
  // Net off: expenses count at their net amount; linked incoming money is excluded.
  const netted = applyNet(rawTxns, links);
  const excluded = opts.excludeTrips === false ? new Set<string>() : await monthlyExclusions(store, rawTxns);
  const txns = netted.filter((t) => !excluded.has(t.id));
  const tripExcluded = netted.filter((t) => excluded.has(t.id)).reduce((a, t) => a + spendCentsOf(t, cats), 0);

  const byRoot = new Map<string, { spent: Cents; count: number }>();
  let total: Cents = 0;
  let income: Cents = 0;
  for (const t of txns) {
    if (t.removed_at) continue;
    const root = rootOf(cats, t.category_id);
    if (root?.kind === "income" && !t.is_transfer) income += toCents(t.amount);
    const s = spendCentsOf(t, cats);
    if (s === 0 && root?.kind !== "expense") continue;
    total += s;
    const key = root?.id ?? "__uncat";
    const cur = byRoot.get(key) ?? { spent: 0, count: 0 };
    cur.spent += s;
    cur.count++;
    byRoot.set(key, cur);
  }
  const scale = opts.scaleBudget ?? ((c: Cents) => c);
  // Budgets on a root apply to root + subcategories; budgets on subcategories
  // are summed into the parent if the parent has none.
  const budgetFor = (root: Category): Cents | null => {
    const own = budgets.find((b) => b.category_id === root.id);
    if (own) return scale(toCents(own.amount_monthly));
    const subs = budgets.filter((b) => cats.find((c) => c.id === b.category_id)?.parent_id === root.id);
    return subs.length ? scale(sumCents(subs.map((b) => b.amount_monthly))) : null;
  };
  const row = (id: string | null, name: string, color: string | null, spent: Cents, budget: Cents | null, count: number): CategorySpend => ({
    category_id: id,
    name,
    color,
    spent: fromCents(spent),
    budget: budget == null ? null : fromCents(budget),
    remaining: budget == null ? null : fromCents(budget - spent),
    pct: budget ? Math.max(0, Math.round((spent * 100) / budget)) : null,
    over: budget != null && spent > budget,
    negative: spent < 0,
    count,
  });
  const rows: CategorySpend[] = [];
  for (const root of cats.filter((c) => !c.parent_id && c.kind === "expense")) {
    const s = byRoot.get(root.id);
    const budget = budgetFor(root);
    if (!s && budget == null && !opts.includeUnbudgeted) continue;
    rows.push(row(root.id, root.name, root.color, s?.spent ?? 0, budget, s?.count ?? 0));
  }
  const unc = byRoot.get("__uncat");
  if (unc) rows.push(row(null, "Uncategorised", "#9ca3af", unc.spent, null, unc.count));
  rows.sort((a, b) => (b.budget ?? -1) - (a.budget ?? -1) || b.spent - a.spent);
  // Savings: money out to Sharesies/Feijoa counts as saved; money back reduces it.
  const saved = txns
    .filter((t) => !t.removed_at && rootOf(cats, t.category_id)?.kind === "savings")
    .reduce((a, t) => a - toCents(t.amount), 0);
  return { rows, total: fromCents(total), income: fromCents(income), trip_excluded: fromCents(tripExcluded), saved: fromCents(saved), txns, cats };
}

/**
 * What makes up one category's spend for a period (the home-page bars).
 * Uses spendingByCategory's own rows, so the total always matches the bar:
 * net offs at their net amount, refunds reduce it, trips kept separate stay out.
 * `category` is a root category id, or null for Uncategorised.
 */
export async function categoryBreakdown(store: Store, category: string | null, from: string, to: string) {
  if (from > to) throw new UserError("from must be on or before to");
  const { txns, cats, trip_excluded } = await spendingByCategory(store, from, to);
  const cat = category ? cats.find((c) => c.id === category && !c.parent_id) : null;
  if (category && !cat) throw new UserError("Category not found");
  const rows = txns
    .filter((t) => !t.removed_at && (cat ? rootOf(cats, t.category_id)?.id === cat.id : !t.category_id))
    .map((t) => ({ t, cents: spendCentsOf(t, cats) }))
    .filter(({ t, cents }) => cents !== 0 || t.category_id) // uncategorised income isn't spending
    .sort((a, b) => b.t.local_date.localeCompare(a.t.local_date) || b.cents - a.cents);
  const merchantOf = (t: Transaction) => t.merchant_name ?? cleanDescription(t.description);
  const merchants = new Map<string, { spent: Cents; count: number }>();
  const subs = new Map<string, { spent: Cents; count: number }>();
  for (const { t, cents } of rows) {
    const m = merchantOf(t);
    const cur = merchants.get(m) ?? { spent: 0, count: 0 };
    cur.spent += cents;
    cur.count++;
    merchants.set(m, cur);
    if (cat && t.category_id !== cat.id) {
      const name = cats.find((c) => c.id === t.category_id)?.name ?? "Other";
      const sc = subs.get(name) ?? { spent: 0, count: 0 };
      sc.spent += cents;
      sc.count++;
      subs.set(name, sc);
    }
  }
  const total: Cents = rows.reduce((a, r) => a + r.cents, 0);
  const list = (m: Map<string, { spent: Cents; count: number }>) =>
    [...m.entries()]
      .sort((a, b) => b[1].spent - a[1].spent)
      .map(([name, v]) => ({ name, spent: fromCents(v.spent), count: v.count, pct: total > 0 ? Math.round((v.spent * 100) / total) : null }));
  return {
    category: cat ? { id: cat.id, name: cat.name, color: cat.color } : { id: null, name: "Uncategorised", color: "#9ca3af" },
    from,
    to,
    total: fromCents(total),
    count: rows.length,
    merchants: list(merchants),
    subcategories: list(subs),
    /** Trip spending left out of every category this period (all categories, not just this one). */
    trip_excluded,
    items: rows.map(({ t, cents }) => ({ id: t.id, spent: fromCents(cents), merchant: merchantOf(t) })),
  };
}

export type PeriodMode = "month" | "cycle";

export async function budgetStatus(
  store: Store,
  opts: { month?: string; mode?: PeriodMode; /** Any date in the wanted period (month or pay cycle); default today. */ at?: string } | string = {},
) {
  const o = typeof opts === "string" ? { month: opts } : opts;
  const today = todayLocal();
  const [settingsRows] = await Promise.all([store.select("settings")]);
  const settings = settingsRows[0];
  const at = o.at && o.at < today ? o.at : today; // never a future period
  const cycle = o.mode === "cycle" && !o.month ? currentCycle(settings, at) : null;

  let from: string, to: string, label: string, key: string, periodEnd: string, isCurrent: boolean;
  let dayOf: number, daysIn: number, daysLeft: number, fracNum: number, fracDen: number;
  let scale: ((c: Cents) => Cents) | undefined;
  if (cycle) {
    isCurrent = cycle.start <= today && today <= cycle.end;
    from = cycle.start;
    periodEnd = cycle.end;
    to = isCurrent ? today : cycle.end;
    key = `cycle:${cycle.start}`;
    label = `Pay cycle ${shortLabel(cycle.start)} – ${shortLabel(cycle.end)}`;
    daysIn = cycle.lengthDays;
    dayOf = isCurrent ? daysBetween(cycle.start, today) + 1 : daysIn;
    daysLeft = isCurrent ? daysBetween(today, cycle.end) : 0;
    [fracNum, fracDen] = isCurrent ? [dayOf, daysIn] : [1, 1];
    scale = (c) => monthlyToCycleCents(c, cycle.frequency);
  } else {
    const ref = o.month ? `${o.month.slice(0, 7)}-01` : at;
    isCurrent = monthKey(ref) === monthKey(today);
    from = monthStart(ref);
    periodEnd = monthEnd(ref);
    to = isCurrent ? today : periodEnd;
    key = monthKey(ref);
    label = monthLabel(monthKey(ref), "long");
    const prog = monthProgress(isCurrent ? today : periodEnd);
    dayOf = prog.dayOfMonth;
    daysIn = prog.daysInMonth;
    daysLeft = isCurrent ? prog.daysLeft : 0;
    [fracNum, fracDen] = isCurrent ? [prog.dayOfMonth, prog.daysInMonth] : [1, 1];
  }
  const spend = await spendingByCategory(store, from, to, { scaleBudget: scale });
  const { rows } = spend;
  // Cumulative spend per day (for the pace chart).
  const perDay = new Map<string, Cents>();
  for (const t of spend.txns) {
    if (t.removed_at) continue;
    const c = spendCentsOf(t, spend.cats);
    if (c) perDay.set(t.local_date, (perDay.get(t.local_date) ?? 0) + c);
  }
  const daily: { date: string; spent: number }[] = [];
  for (let d = from, run = 0; d <= to; d = addDays(d, 1)) {
    run += perDay.get(d) ?? 0;
    daily.push({ date: d, spent: fromCents(run) });
  }
  const capMonthly = settings?.overall_monthly_cap == null ? null : toCents(settings.overall_monthly_cap);
  const cap = capMonthly == null ? null : (scale ?? ((c: Cents) => c))(capMonthly);
  const goalMonthly = settings?.monthly_savings_goal == null ? null : toCents(settings.monthly_savings_goal);
  const savingsGoal = goalMonthly == null ? null : (scale ?? ((c: Cents) => c))(goalMonthly);
  const savedC = toCents(spend.saved);
  const budgeted = rows.filter((r) => r.budget != null);
  const totalBudget = sumCents(budgeted.map((r) => r.budget!));
  const categories = rows.map((r) => {
    const b = r.budget == null ? null : toCents(r.budget);
    const expected = b == null ? null : mulDiv(b, fracNum, fracDen);
    const spent = toCents(r.spent);
    return {
      ...r,
      expected_by_now: expected == null ? null : fromCents(expected),
      status:
        b == null
          ? "no budget"
          : spent > b
            ? "over budget"
            : expected != null && spent * 10 > expected * 11
              ? "ahead of pace"
              : "on track",
    };
  });
  // With an overall cap, compare all spending to it; otherwise compare the
  // budgeted categories' spending to the sum of their budgets.
  const total = toCents(spend.total);
  const budgetedSpent = sumCents(budgeted.map((r) => r.spent));
  const limit = cap ?? (totalBudget || null);
  const measured = cap != null ? total : budgetedSpent;
  return {
    mode: cycle ? ("cycle" as const) : ("month" as const),
    cycle_available: Boolean(settings?.pay_frequency && settings?.next_payday),
    period_key: key,
    month: cycle ? monthKey(today) : key,
    month_label: label,
    period_label: label,
    from,
    to,
    period_end: periodEnd,
    is_current: isCurrent,
    /** Dates to load the previous/next period (null when the next one hasn't started). */
    prev_at: addDays(from, -1),
    next_at: isCurrent ? null : addDays(periodEnd, 1),
    daily,
    day_of_month: dayOf,
    days_in_month: daysIn,
    days_left: daysLeft,
    month_fraction_elapsed: Math.round((fracNum * 100) / fracDen) / 100,
    total_spent: fromCents(total),
    income: spend.income,
    trip_excluded: spend.trip_excluded,
    saved: fromCents(savedC),
    savings_goal: savingsGoal == null ? null : fromCents(savingsGoal),
    savings_pct: savingsGoal ? Math.max(0, Math.round((savedC * 100) / savingsGoal)) : null,
    overall_cap: cap == null ? null : fromCents(cap),
    total_of_category_budgets: fromCents(totalBudget),
    budgeted_categories_spent: fromCents(budgetedSpent),
    remaining: limit == null ? null : fromCents(limit - measured),
    projected_month_spend: fromCents(mulDiv(total, fracDen, fracNum)),
    // within 5% of the pro-rata limit and no category over
    on_track: limit == null ? null : measured * 100 * fracDen <= limit * fracNum * 105 && !categories.some((c) => c.over),
    categories,
  };
}

function shortLabel(ld: string) {
  const [y, m, d] = ld.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });
}

export async function querySpending(
  store: Store,
  input: { from: string; to: string; category?: string; merchant?: string },
) {
  const [rawRows, links, cats] = await Promise.all([
    findTransactions(store, { from: input.from, to: input.to, category: input.category, merchant: input.merchant }),
    loadLinkTotals(store),
    store.select("categories"),
  ]);
  const rows = applyNet(rawRows, links); // net of reimbursements
  // For a merchant/category question count the actual spend (refunds net off).
  // Trips are included here: this answers "how much did I spend", not budgets.
  const relevant = rows.filter((t) => !t.is_transfer && !t.removed_at);
  const spend = (t: Transaction): Cents => (rootOf(cats, t.category_id)?.kind === "income" ? 0 : -toCents(t.amount));
  const byMonth = new Map<string, Cents>();
  const byMerchant = new Map<string, { total: Cents; count: number }>();
  let total: Cents = 0;
  for (const t of relevant) {
    const s = spend(t);
    total += s;
    byMonth.set(monthKey(t.local_date), (byMonth.get(monthKey(t.local_date)) ?? 0) + s);
    const m = t.merchant_name ?? t.description;
    const cur = byMerchant.get(m) ?? { total: 0, count: 0 };
    cur.total += s;
    cur.count++;
    byMerchant.set(m, cur);
  }
  const incomeTotal = sumCents(relevant.filter((t) => rootOf(cats, t.category_id)?.kind === "income").map((t) => t.amount));
  return {
    from: input.from,
    to: input.to,
    category: input.category ?? null,
    merchant: input.merchant ?? null,
    total_spent: fromCents(total),
    income_received: fromCents(incomeTotal),
    transaction_count: relevant.length,
    excluded_transfers: rows.filter((t) => t.is_transfer).length,
    by_month: [...byMonth.entries()].sort().map(([month, c]) => ({ month, spent: fromCents(c) })),
    top_merchants: [...byMerchant.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([name, v]) => ({ name: clip(name), spent: fromCents(v.total), count: v.count })),
    largest: [...relevant]
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 5)
      .map((t) => ({ date: t.local_date, description: clip(t.description), amount: t.amount, category: categoryLabel(cats, t.category_id) })),
  };
}

export { clip } from "@/lib/text";
import { clip, cleanDescription } from "@/lib/text";

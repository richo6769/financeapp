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
  addMonths,
  localDateToIso,
  monthEnd,
  monthKey,
  monthLabel,
  monthProgress,
  monthStart,
  todayLocal,
} from "@/lib/dates";
import { round2, toMonthly } from "@/lib/money";
import { merchantPattern, normalise, ruleMatches } from "@/lib/categorise";

export const BULK_CONFIRM_THRESHOLD = 20;

export class UserError extends Error {}

// ---------------------------------------------------------------- categories

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

export async function createCategory(
  store: Store,
  input: { name: string; parent?: string | null; kind?: CategoryKind; color?: string | null },
): Promise<Category> {
  const cats = await store.select("categories");
  const name = input.name.trim();
  if (!name) throw new UserError("Category name is required");
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
  if (patch.name?.trim()) next.name = patch.name.trim();
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
  const period = input.period ?? "monthly";
  const { monthly, explanation } = toMonthly(input.amount, period);
  const [budget] = await store.upsert(
    "budgets",
    [{ category_id: cat.id, amount_monthly: monthly, period, period_amount: round2(input.amount) }],
    "user_id,category_id",
  );
  return { budget, category: categoryLabel(cats, cat.id), explanation };
}

export async function removeBudget(store: Store, categoryRef: string): Promise<number> {
  const cats = await store.select("categories");
  const cat = requireCategory(cats, categoryRef);
  return store.remove("budgets", { eq: { category_id: cat.id } });
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
    apply_to_existing?: boolean;
    confirmed?: boolean;
  },
): Promise<{ rule: Rule | null; category: string; matched_existing: number; applied: number; needs_confirmation: boolean }> {
  const pattern = input.pattern.trim();
  if (!pattern) throw new UserError("Rule pattern is required");
  if (input.match_type === "regex") {
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new UserError("Invalid regular expression");
    }
  }
  const cats = await store.select("categories");
  const cat = requireCategory(cats, input.category);
  const draft = { pattern, field: input.field ?? "any", match_type: input.match_type ?? "contains" } as const;

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
      { category_id: cat.id, category_source: "rule", is_transfer: cat.kind === "transfer" },
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
  if (f.category === "uncategorised") rows = rows.filter((t) => !t.category_id);
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
        { category_id: target.id, category_source: "manual", is_transfer: target.kind === "transfer" },
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
      is_transfer: cat?.kind === "transfer",
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
  const amount = cat?.kind === "income" ? Math.abs(input.amount) : -Math.abs(input.amount);
  const [transaction] = await store.insert("transactions", [
    {
      akahu_id: null,
      account_id: null,
      date: localDateToIso(ld),
      local_date: ld,
      description: input.description,
      merchant_name: null,
      amount: round2(amount),
      type: "CASH",
      akahu_category: null,
      category_id: cat?.id ?? null,
      category_source: cat ? "manual" : null,
      is_transfer: false,
      is_manual: true,
      notes: input.notes ?? null,
    },
  ]);
  return { transaction, category: cat ? categoryLabel(cats, cat.id) : "Uncategorised" };
}

// ------------------------------------------------------------------ analytics

/**
 * Spending rules:
 *  - Transfers (own-account moves, card repayments) never count.
 *  - Income categories never count.
 *  - Expense-category rows count as -amount, so refunds (credits) reduce
 *    spend in their original category.
 *  - Uncategorised debits count as spend (so totals are honest before triage);
 *    uncategorised credits are ignored until categorised.
 */
export function spendOf(t: Transaction, cats: Category[]): number {
  if (t.is_transfer) return 0;
  if (!t.category_id) return t.amount < 0 ? -t.amount : 0;
  const root = rootOf(cats, t.category_id);
  if (!root || root.kind !== "expense") return 0;
  return -t.amount;
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
  count: number;
}

export async function spendingByCategory(
  store: Store,
  from: string,
  to: string,
  opts: { includeUnbudgeted?: boolean } = {},
): Promise<{ rows: CategorySpend[]; total: number; income: number; txns: Transaction[]; cats: Category[] }> {
  const [cats, txns, budgets] = await Promise.all([
    store.select("categories"),
    store.select("transactions", { gte: { local_date: from }, lte: { local_date: to } }),
    store.select("budgets"),
  ]);
  const byRoot = new Map<string, { spent: number; count: number }>();
  let total = 0;
  let income = 0;
  for (const t of txns) {
    const s = spendOf(t, cats);
    const root = rootOf(cats, t.category_id);
    if (root?.kind === "income" && !t.is_transfer) income += t.amount;
    if (s === 0 && !(root?.kind === "expense")) continue;
    total += s;
    const key = root?.id ?? "__uncat";
    const cur = byRoot.get(key) ?? { spent: 0, count: 0 };
    cur.spent += s;
    cur.count++;
    byRoot.set(key, cur);
  }
  // Budgets on a root apply to root + subcategories; budgets on subcategories
  // are summed into the parent if the parent has none.
  const budgetFor = (root: Category): number | null => {
    const own = budgets.find((b) => b.category_id === root.id);
    if (own) return own.amount_monthly;
    const subs = budgets.filter((b) => cats.find((c) => c.id === b.category_id)?.parent_id === root.id);
    return subs.length ? subs.reduce((a, b) => a + b.amount_monthly, 0) : null;
  };
  const rows: CategorySpend[] = [];
  for (const root of cats.filter((c) => !c.parent_id && c.kind === "expense")) {
    const s = byRoot.get(root.id);
    const budget = budgetFor(root);
    if (!s && budget == null && !opts.includeUnbudgeted) continue;
    const spent = round2(s?.spent ?? 0);
    rows.push({
      category_id: root.id,
      name: root.name,
      color: root.color,
      spent,
      budget,
      remaining: budget == null ? null : round2(budget - spent),
      pct: budget ? Math.round((spent / budget) * 100) : null,
      over: budget != null && spent > budget,
      count: s?.count ?? 0,
    });
  }
  const unc = byRoot.get("__uncat");
  if (unc) {
    rows.push({
      category_id: null,
      name: "Uncategorised",
      color: "#9ca3af",
      spent: round2(unc.spent),
      budget: null,
      remaining: null,
      pct: null,
      over: false,
      count: unc.count,
    });
  }
  rows.sort((a, b) => (b.budget ?? -1) - (a.budget ?? -1) || b.spent - a.spent);
  return { rows, total: round2(total), income: round2(income), txns, cats };
}

export async function budgetStatus(store: Store, month?: string) {
  const today = todayLocal();
  const ref = month ? `${month.slice(0, 7)}-01` : today;
  const isCurrent = monthKey(ref) === monthKey(today);
  const from = monthStart(ref);
  const to = isCurrent ? today : monthEnd(ref);
  const prog = isCurrent ? monthProgress(today) : { ...monthProgress(monthEnd(ref)), daysLeft: 0, fraction: 1 };
  const [{ rows, total, income }, settings] = await Promise.all([
    spendingByCategory(store, from, to),
    store.select("settings"),
  ]);
  const cap = settings[0]?.overall_monthly_cap ?? null;
  const budgeted = rows.filter((r) => r.budget != null);
  const totalBudget = round2(budgeted.reduce((a, r) => a + (r.budget ?? 0), 0));
  const categories = rows.map((r) => {
    const expected = r.budget != null ? round2(r.budget * prog.fraction) : null;
    return {
      ...r,
      expected_by_now: expected,
      status:
        r.budget == null
          ? "no budget"
          : r.spent > r.budget
            ? "over budget"
            : expected != null && r.spent > expected * 1.1
              ? "ahead of pace"
              : "on track",
    };
  });
  // With an overall cap, compare all spending to it; otherwise compare the
  // budgeted categories' spending to the sum of their budgets.
  const budgetedSpent = round2(budgeted.reduce((a, r) => a + r.spent, 0));
  const limit = cap ?? (totalBudget || null);
  const measured = cap != null ? total : budgetedSpent;
  return {
    month: monthKey(ref),
    month_label: monthLabel(monthKey(ref), "long"),
    day_of_month: prog.dayOfMonth,
    days_in_month: prog.daysInMonth,
    days_left: prog.daysLeft,
    month_fraction_elapsed: round2(prog.fraction),
    total_spent: total,
    income,
    overall_cap: cap,
    total_of_category_budgets: totalBudget,
    budgeted_categories_spent: budgetedSpent,
    remaining: limit == null ? null : round2(limit - measured),
    projected_month_spend: prog.fraction > 0 ? round2(total / prog.fraction) : total,
    on_track: limit == null ? null : measured <= limit * prog.fraction * 1.05 && !categories.some((c) => c.over),
    categories,
  };
}

export async function querySpending(
  store: Store,
  input: { from: string; to: string; category?: string; merchant?: string },
) {
  const rows = await findTransactions(store, {
    from: input.from,
    to: input.to,
    category: input.category,
    merchant: input.merchant,
  });
  const cats = await store.select("categories");
  // For a merchant/category question count the actual spend (refunds net off).
  const relevant = rows.filter((t) => !t.is_transfer);
  const spend = (t: Transaction) => {
    const root = rootOf(cats, t.category_id);
    if (root?.kind === "income") return 0;
    return -t.amount;
  };
  const byMonth = new Map<string, number>();
  const byMerchant = new Map<string, { total: number; count: number }>();
  let total = 0;
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
  const incomeTotal = relevant
    .filter((t) => rootOf(cats, t.category_id)?.kind === "income")
    .reduce((a, t) => a + t.amount, 0);
  return {
    from: input.from,
    to: input.to,
    category: input.category ?? null,
    merchant: input.merchant ?? null,
    total_spent: round2(total),
    income_received: round2(incomeTotal),
    transaction_count: relevant.length,
    excluded_transfers: rows.length - relevant.length,
    by_month: [...byMonth.entries()].sort().map(([month, amt]) => ({ month, spent: round2(amt) })),
    top_merchants: [...byMerchant.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([name, v]) => ({ name, spent: round2(v.total), count: v.count })),
    largest: relevant
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 5)
      .map((t) => ({ date: t.local_date, description: t.description, amount: t.amount, category: categoryLabel(cats, t.category_id) })),
  };
}

export async function dashboard(store: Store) {
  const today = todayLocal();
  const status = await budgetStatus(store);
  const trendFrom = monthStart(addMonths(today, -5));
  const [{ txns, cats }, accounts, pending, lastSync, uncategorised] = await Promise.all([
    spendingByCategory(store, trendFrom, today),
    store.select("accounts"),
    store.select("pending_transactions"),
    store.select("sync_log", undefined, { order: { column: "started_at", ascending: false }, limit: 1 }),
    store.select("transactions", { eq: { category_id: null } }),
  ]);
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) months.push(monthKey(addMonths(monthStart(today), -i)));
  const trend = months.map((m) => ({
    month: m,
    label: monthLabel(m),
    spent: round2(txns.filter((t) => monthKey(t.local_date) === m).reduce((a, t) => a + spendOf(t, cats), 0)),
  }));
  const thisMonth = txns.filter((t) => t.local_date >= monthStart(today));
  const merchants = new Map<string, { spent: number; count: number }>();
  for (const t of thisMonth) {
    const s = spendOf(t, cats);
    if (s <= 0) continue;
    const key = t.merchant_name ?? t.description;
    const cur = merchants.get(key) ?? { spent: 0, count: 0 };
    cur.spent += s;
    cur.count++;
    merchants.set(key, cur);
  }
  return {
    status,
    trend,
    top_merchants: [...merchants.entries()]
      .sort((a, b) => b[1].spent - a[1].spent)
      .slice(0, 6)
      .map(([name, v]) => ({ name, spent: round2(v.spent), count: v.count })),
    accounts,
    pending: pending.sort((a, b) => b.date.localeCompare(a.date)),
    last_sync: lastSync[0] ?? null,
    uncategorised_count: uncategorised.length,
  };
}

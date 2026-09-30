import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Store } from "@/lib/store/types";
import { parseLocalDate, resolvePeriod, todayLocal, type PeriodPreset } from "@/lib/dates";
import {
  addManualTransaction,
  budgetStatus,
  createCategory,
  createRule,
  deleteCategory,
  querySpending,
  recategoriseTransactions,
  removeBudget,
  setBudget,
  setOverallCap,
  updateCategory,
  UserError,
} from "@/lib/services";
import { findExpenseCandidates, matchAndLink, nameMatches } from "@/lib/reimburse";
import { cancelIou, createIou, listIous, owedByPerson, type IouView } from "@/lib/iou";
import { createTrip, findTrip, tripSummary } from "@/lib/trips";
import { setWeeklyCap, weeklyCapStatus } from "@/lib/caps";
import { listSubscriptions } from "@/lib/subscriptions";
import { clip, requireCategory } from "@/lib/services";

const period = z.enum(["weekly", "fortnightly", "monthly", "yearly"]);
const presets = z.enum([
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "year_to_date",
  "all_time",
]);
const confirmFields = {
  confirmed: z
    .boolean()
    .optional()
    .describe("Only true after the user explicitly agreed to a preview you showed them in a previous message."),
  confirmation_token: z
    .string()
    .optional()
    .describe("The confirmation_token returned by the preview call. Required with confirmed=true."),
};

const schemas = {
  create_category: z.object({
    name: z.string().describe("Category name, e.g. 'Pets'"),
    parent: z.string().optional().describe("Parent category name to make this a subcategory"),
    kind: z.enum(["expense", "income", "transfer"]).optional().describe("Defaults to expense"),
  }),
  update_category: z.object({
    category: z.string().describe("Existing category name"),
    new_name: z.string().optional(),
    parent: z.string().nullable().optional().describe("New parent name, or null to make it top-level"),
    kind: z.enum(["expense", "income", "transfer"]).optional(),
  }),
  delete_category: z.object({
    category: z.string().describe("Category to delete (its subcategories are deleted too; transactions become uncategorised)"),
    ...confirmFields,
  }),
  set_budget: z.object({
    category: z.string().optional().describe("Category name. Omit when setting the overall monthly cap."),
    overall: z.boolean().optional().describe("true to set the overall monthly spending cap instead of a category budget"),
    amount: z.number().min(0).nullable().describe("Amount in NZD per `period`. null removes the budget/cap."),
    period: period.optional().describe("How often the amount applies. Converted to monthly (weekly ×52/12, fortnightly ×26/12)."),
  }),
  create_rule: z.object({
    pattern: z.string().describe("Text to match, e.g. 'Z Energy'. Case/punctuation-insensitive."),
    category: z.string(),
    field: z.enum(["merchant", "description", "any"]).optional().describe("Default any"),
    match_type: z.enum(["contains", "exact", "regex"]).optional().describe("Default contains"),
    apply_to_existing: z.boolean().optional().describe("Also recategorise matching past transactions (default true)"),
    ...confirmFields,
  }),
  recategorise_transactions: z.object({
    new_category: z.string(),
    merchant: z.string().optional().describe("Merchant/description text to match"),
    date_from: z.string().optional().describe("YYYY-MM-DD inclusive"),
    date_to: z.string().optional().describe("YYYY-MM-DD inclusive"),
    min_amount: z.number().optional().describe("Minimum absolute amount"),
    max_amount: z.number().optional().describe("Maximum absolute amount"),
    current_category: z.string().optional().describe("Only move transactions currently in this category ('uncategorised' allowed)"),
    create_rule: z.boolean().optional().describe("Also create a rule for this merchant for future transactions"),
    ...confirmFields,
  }),
  add_manual_transaction: z.object({
    description: z.string().describe("What it was, e.g. 'Haircut (cash)'"),
    amount: z.number().positive().describe("Positive NZD amount spent (or received, for income categories)"),
    date: z.string().optional().describe("YYYY-MM-DD, 'today' or 'yesterday'. Defaults to today (NZ time)."),
    category: z.string().optional(),
    notes: z.string().optional(),
  }),
  query_spending: z.object({
    category: z.string().optional(),
    merchant: z.string().optional().describe("Merchant or description text, e.g. 'Uber Eats'"),
    period: presets.optional().describe("Named period (NZ time). Ignored if date_from/date_to are given."),
    date_from: z.string().optional().describe("YYYY-MM-DD"),
    date_to: z.string().optional().describe("YYYY-MM-DD"),
  }),
  link_reimbursement: z.object({
    expense: z.string().optional().describe("Merchant/description of the expense, e.g. 'Snus Direct' or 'Soul Bar'"),
    expense_amount: z.number().positive().optional().describe("Full expense amount if known"),
    expense_date: z.string().optional().describe("YYYY-MM-DD / 'yesterday' (±3 days is searched)"),
    income_from: z.string().optional().describe("Who paid me back, as it might appear on the bank line, e.g. 'Sam'"),
    income_amount: z.number().positive().optional().describe("Amount of the incoming payment if known, e.g. 100"),
    income_date: z.string().optional().describe("YYYY-MM-DD (±3 days is searched)"),
    amount: z.number().positive().optional().describe("How much of the payment to apply to this expense. Omit to apply as much as fits."),
    fraction: z.number().gt(0).max(1).optional().describe("Share of the expense that was paid back, e.g. 0.5 for 'half'"),
    expense_id: z.string().optional().describe("Exact expense id, when the user picked one from candidates"),
    income_id: z.string().optional().describe("Exact incoming-payment id, when the user picked one from candidates"),
  }),
  create_iou: z.object({
    person: z.string().min(1).max(60).describe("Who owes the user, e.g. 'Sam'"),
    amount: z.number().positive().optional().describe("How much they owe. Omit for the full expense."),
    expense: z.string().optional().describe("Merchant/description of the expense, e.g. 'Snus Direct'"),
    expense_amount: z.number().positive().optional(),
    expense_date: z.string().optional().describe("YYYY-MM-DD / 'yesterday' (±3 days)"),
    expense_id: z.string().optional().describe("Exact expense id, when the user picked one from candidates"),
  }),
  list_ious: z.object({
    person: z.string().optional().describe("Only this person"),
    include_settled: z.boolean().optional(),
  }),
  cancel_iou: z.object({
    person: z.string().optional(),
    expense: z.string().optional().describe("Merchant/description of the expense the IOU is on"),
    iou_id: z.string().optional().describe("Exact IOU id, when the user picked one"),
  }),
  create_trip: z.object({
    name: z.string().min(1).max(60),
    start_date: z.string().describe("YYYY-MM-DD (or '26 Dec')"),
    end_date: z.string().describe("YYYY-MM-DD (or '17 Jan')"),
    budget: z.number().min(0).optional().describe("Total trip budget in NZD"),
    exclude_from_monthly: z.boolean().optional().describe("Default true: trip spending doesn't count toward monthly budgets"),
    include_all_spending: z.boolean().optional().describe("Count ALL spending in the date range, not just foreign/Travel"),
  }),
  trip_status: z.object({
    trip: z.string().optional().describe("Trip name; omit for the current/most recent trip"),
  }),
  set_weekly_cap: z.object({
    category: z.string(),
    amount: z.number().positive().nullable().describe("Weekly cap in NZD (Mon–Sun). null removes it."),
  }),
  weekly_status: z.object({
    category: z.string().optional().describe("Only this category"),
  }),
  list_subscriptions: z.object({}),
  get_budget_status: z.object({
    month: z.string().optional().describe("YYYY-MM. Defaults to the current month."),
    pay_cycle: z.boolean().optional().describe("Use the current pay cycle instead of the calendar month (if set up)"),
  }),
} as const;

export type ToolName = keyof typeof schemas;

const descriptions: Record<ToolName, string> = {
  create_category: "Create a spending category or a subcategory.",
  update_category: "Rename a category, move it under a parent, or change its kind.",
  delete_category:
    "Delete a category. DESTRUCTIVE: always call first without `confirmed` to get a preview + confirmation_token, show the user the preview, and only call again with confirmed=true and the token after they say yes.",
  set_budget:
    "Set a monthly budget for a category, or the overall monthly cap (overall=true). Weekly/fortnightly/yearly amounts are converted to monthly and the conversion is returned — show it to the user.",
  create_rule:
    "Create an auto-categorisation rule (pattern → category), applied to future syncs and by default to matching past transactions. If it would change 20+ past transactions the result says needs_confirmation — ask the user first.",
  recategorise_transactions:
    "Move existing transactions matching filters to a category. If 20+ match, the first call returns needs_confirmation with a preview; ask the user before calling again with confirmed=true and the token.",
  add_manual_transaction: "Record a cash (or other off-bank) transaction.",
  query_spending:
    "Get exact spending totals from the database, filtered by category and/or merchant over a period. Returns total, monthly breakdown, top merchants and largest transactions. Use for every spending question.",
  link_reimbursement:
    "Net off an expense with money someone paid me back (e.g. 'the $100 from Sam was for Snus Direct', 'Jack paid me back half of dinner at Soul Bar'). The expense then counts at its net amount and the linked incoming money is excluded from income. Searches the last 6 months by name, amount and date. If more than one expense or payment matches it links NOTHING and returns needs_choice with candidates — show them (date, description, amount) and ask which, then call again with expense_id/income_id.",
  create_iou:
    "Record that someone owes the user money for an expense ('Sam owes me 100 for Snus Direct'). If several expenses match it creates nothing and returns needs_choice — ask which, then call again with expense_id. When a matching payment is later netted off, the IOU settles automatically (partial payments reduce the balance).",
  list_ious: "Who owes the user money: open IOUs grouped by person with balances and age in days.",
  cancel_iou:
    "Cancel an IOU (it's forgiven or was a mistake). If more than one open IOU matches, returns needs_choice — ask which, then call again with iou_id.",
  create_trip:
    "Create a trip (e.g. 'SEA trip from 26 Dec to 17 Jan, budget 5000'). Transactions in the date range that are foreign-currency or Travel are tagged automatically; by default trip spending is kept out of monthly budgets.",
  trip_status: "How a trip is tracking: spent vs budget, daily average, remaining per day, by category.",
  set_weekly_cap: "Set or remove a weekly (Mon–Sun) spending cap for a category, e.g. 'cap bars at 80 a week'.",
  weekly_status: "This week's spending vs weekly caps (Mon–Sun, NZ). Use for 'how am I tracking on X this week?'.",
  list_subscriptions: "Detected recurring charges with amount, frequency, next expected date, monthly total and flags.",
  get_budget_status:
    "Budget vs actual for a month: per-category spent/budget/remaining/pace, total, days left, projection and on_track.",
};

function jsonSchema(s: z.ZodType): Anthropic.Tool.InputSchema {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s) as Record<string, unknown>;
  void _drop;
  return rest as Anthropic.Tool.InputSchema;
}

export const TOOL_DEFS: Anthropic.Tool[] = (Object.keys(schemas) as ToolName[]).map((name) => ({
  name,
  description: descriptions[name],
  input_schema: jsonSchema(schemas[name]),
}));

// ------------------------------------------------------------ confirmation

/** Deterministic token binding a confirmation to the exact action + args. */
export function confirmationToken(name: string, args: Record<string, unknown>): string {
  const { confirmed: _c, confirmation_token: _t, ...rest } = args;
  void _c;
  void _t;
  const stable = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash("sha256").update(`${name}:${stable}`).digest("hex").slice(0, 12);
}

export interface ToolContext {
  store: Store;
  /** Tokens issued in *previous* turns (so a confirmation needs a user reply). */
  priorTokens: Set<string>;
}

type Result = Record<string, unknown>;

function needsConfirmation(name: ToolName, args: Record<string, unknown>, preview: Result): Result {
  return {
    needs_confirmation: true,
    confirmation_token: confirmationToken(name, args),
    preview,
    instruction:
      "Nothing has been changed yet. Show the user this preview and ask them to confirm. If they agree, call the same tool again with identical arguments plus confirmed=true and this confirmation_token.",
  };
}

function checkConfirmation(ctx: ToolContext, name: ToolName, args: Record<string, unknown>): boolean {
  if (!args.confirmed) return false;
  const expected = confirmationToken(name, args);
  return args.confirmation_token === expected && ctx.priorTokens.has(expected);
}

const iouBrief = (i: IouView) => ({
  id: i.id,
  person: i.person_name,
  amount: i.amount,
  balance: i.balance,
  status: i.status,
  age_days: i.age_days,
  expense: i.expense ? `${clip(i.expense.description)} on ${i.expense.date}` : null,
});

// ---------------------------------------------------------------- executor

export async function executeTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<Result> {
  if (!(name in schemas)) return { error: `Unknown tool ${name}` };
  const parsed = schemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success) return { error: `Invalid input: ${parsed.error.message}` };
  const args = parsed.data as Record<string, unknown>;
  const { store } = ctx;
  try {
    switch (name as ToolName) {
      case "create_category": {
        const a = parsed.data as z.infer<typeof schemas.create_category>;
        const c = await createCategory(store, a);
        return { ok: true, category: c.name, id: c.id, parent: a.parent ?? null, kind: c.kind };
      }
      case "update_category": {
        const a = parsed.data as z.infer<typeof schemas.update_category>;
        const c = await updateCategory(store, a.category, { name: a.new_name, parent: a.parent, kind: a.kind });
        return { ok: true, category: c.name, kind: c.kind };
      }
      case "delete_category": {
        const a = parsed.data as z.infer<typeof schemas.delete_category>;
        const confirmed = checkConfirmation(ctx, "delete_category", args);
        const res = await deleteCategory(store, a.category, { confirmed });
        if (!res.deleted) return needsConfirmation("delete_category", args, { ...res.preview });
        return { ok: true, deleted: res.preview };
      }
      case "set_budget": {
        const a = parsed.data as z.infer<typeof schemas.set_budget>;
        if (a.overall) {
          const r = await setOverallCap(store, a.amount, a.period ?? "monthly");
          return { ok: true, overall_monthly_cap: r.monthly, conversion: r.explanation };
        }
        if (!a.category) return { error: "category is required unless overall=true" };
        if (a.amount == null) {
          const n = await removeBudget(store, a.category);
          return { ok: true, removed: n > 0, category: a.category };
        }
        const r = await setBudget(store, { category: a.category, amount: a.amount, period: a.period });
        return { ok: true, category: r.category, monthly_budget: r.budget.amount_monthly, conversion: r.explanation };
      }
      case "create_rule": {
        const a = parsed.data as z.infer<typeof schemas.create_rule>;
        const confirmed = checkConfirmation(ctx, "create_rule", args);
        const r = await createRule(store, { ...a, confirmed });
        if (r.needs_confirmation) {
          return needsConfirmation("create_rule", args, {
            rule: `${a.pattern} → ${r.category}`,
            past_transactions_that_would_change: r.matched_existing,
          });
        }
        return {
          ok: true,
          rule: `${a.pattern} → ${r.category}`,
          past_transactions_recategorised: r.applied,
        };
      }
      case "recategorise_transactions": {
        const a = parsed.data as z.infer<typeof schemas.recategorise_transactions>;
        const confirmed = checkConfirmation(ctx, "recategorise_transactions", args);
        const r = await recategoriseTransactions(
          store,
          {
            merchant: a.merchant,
            from: a.date_from ? parseLocalDate(a.date_from) : undefined,
            to: a.date_to ? parseLocalDate(a.date_to) : undefined,
            min_amount: a.min_amount,
            max_amount: a.max_amount,
            category: a.current_category,
          },
          a.new_category,
          { confirmed, create_rule: a.create_rule },
        );
        if (r.needs_confirmation) {
          return needsConfirmation("recategorise_transactions", args, {
            transactions_that_would_move: r.matched,
            to_category: r.category,
            sample: r.sample,
          });
        }
        return { ok: true, updated: r.updated, to_category: r.category, rule_created: r.rule_created ?? null, sample: r.sample };
      }
      case "add_manual_transaction": {
        const a = parsed.data as z.infer<typeof schemas.add_manual_transaction>;
        const date = parseLocalDate(a.date);
        const r = await addManualTransaction(store, { ...a, date });
        return {
          ok: true,
          date: r.transaction.local_date,
          description: r.transaction.description,
          amount: r.transaction.amount,
          category: r.category,
        };
      }
      case "query_spending": {
        const a = parsed.data as z.infer<typeof schemas.query_spending>;
        const today = todayLocal();
        const range =
          a.date_from || a.date_to
            ? { from: a.date_from ? parseLocalDate(a.date_from) : "1970-01-01", to: a.date_to ? parseLocalDate(a.date_to) : today }
            : resolvePeriod((a.period ?? "this_month") as PeriodPreset, today);
        return await querySpending(store, { ...range, category: a.category, merchant: a.merchant });
      }
      case "link_reimbursement": {
        const a = parsed.data as z.infer<typeof schemas.link_reimbursement>;
        if (!a.expense && !a.expense_id) return { error: "Say which expense (expense or expense_id)" };
        if (!a.income_from && !a.income_amount && !a.income_id) return { error: "Say who paid (income_from), the amount, or income_id" };
        const r = await matchAndLink(store, {
          ...a,
          expense_date: a.expense_date ? parseLocalDate(a.expense_date) : undefined,
          income_date: a.income_date ? parseLocalDate(a.income_date) : undefined,
        });
        if (r.status === "not_found") return { error: r.message };
        if (r.status === "needs_choice") {
          return {
            needs_choice: true,
            instruction: "Nothing linked yet. Ask the user which expense and/or payment they mean, then call again with expense_id and income_id.",
            expense_candidates: r.expense_candidates,
            income_candidates: r.income_candidates,
            amount_to_link: r.amount,
          };
        }
        const x = r.result;
        return {
          ok: true,
          linked: x.amount,
          expense: `${x.expense.name}: $${x.expense.gross.toFixed(2)} → $${x.expense.net.toFixed(2)} net`,
          income: `${x.income.name} $${x.income.amount.toFixed(2)} (unallocated $${x.income.unallocated.toFixed(2)})`,
        };
      }
      case "get_budget_status": {
        const a = parsed.data as z.infer<typeof schemas.get_budget_status>;
        return await budgetStatus(store, { month: a.month, mode: a.pay_cycle ? "cycle" : "month" });
      }
      case "create_iou": {
        const a = parsed.data as z.infer<typeof schemas.create_iou>;
        if (!a.expense && !a.expense_id) return { error: "Say which expense (expense or expense_id)" };
        const found = await findExpenseCandidates(store, {
          expense: a.expense,
          expense_amount: a.expense_amount,
          expense_date: a.expense_date ? parseLocalDate(a.expense_date) : undefined,
          expense_id: a.expense_id,
        });
        if (!found.length) return { error: `No expense matching "${a.expense ?? a.expense_id}" in the last 6 months` };
        if (found.length > 1) {
          return {
            needs_choice: true,
            instruction: "Nothing created yet. Ask which expense, then call again with expense_id.",
            expense_candidates: found.slice(0, 8).map((t) => ({ id: t.id, date: t.local_date, description: clip(t.merchant_name ?? t.description), amount: t.amount })),
            income_candidates: [],
          };
        }
        const iou = await createIou(store, { expense_id: found[0].id, person_name: a.person, amount: a.amount });
        return { ok: true, person: iou.person_name, amount: iou.amount, expense: clip(found[0].merchant_name ?? found[0].description), expense_date: found[0].local_date };
      }
      case "list_ious": {
        const a = parsed.data as z.infer<typeof schemas.list_ious>;
        if (a.include_settled || a.person) {
          const rows = await listIous(store, { status: a.include_settled ? "all" : "open", person: a.person });
          return { ious: rows.map(iouBrief) };
        }
        const owed = await owedByPerson(store);
        return { total_owed: owed.total, people: owed.people.map((p) => ({ person: p.person, total: p.total, oldest_days: p.oldest_days, ious: p.ious.map(iouBrief) })) };
      }
      case "cancel_iou": {
        const a = parsed.data as z.infer<typeof schemas.cancel_iou>;
        let open = await listIous(store, { status: "open", person: a.person });
        if (a.iou_id) open = open.filter((i) => i.id === a.iou_id);
        if (a.expense) open = open.filter((i) => i.expense && nameMatches(a.expense!, { description: i.expense.description, merchant_name: null }));
        if (!open.length) return { error: "No matching open IOU" };
        if (open.length > 1) {
          return { needs_choice: true, instruction: "Nothing cancelled. Ask which IOU, then call again with iou_id.", iou_candidates: open.map(iouBrief) };
        }
        const c = await cancelIou(store, open[0].id);
        return { ok: true, cancelled: iouBrief({ ...open[0], ...c }) };
      }
      case "create_trip": {
        const a = parsed.data as z.infer<typeof schemas.create_trip>;
        const start = parseLocalDate(a.start_date);
        let end = parseLocalDate(a.end_date);
        if (end < start && !/\d{4}/.test(a.end_date)) end = `${Number(end.slice(0, 4)) + 1}${end.slice(4)}`; // "26 Dec → 17 Jan"
        const trip = await createTrip(store, {
          name: a.name,
          start_date: start,
          end_date: end,
          budget: a.budget ?? null,
          exclude_from_monthly: a.exclude_from_monthly,
          include_all: a.include_all_spending,
        });
        const s = await tripSummary(store, trip.id);
        return { ok: true, trip: trip.name, start_date: trip.start_date, end_date: trip.end_date, budget: trip.budget, exclude_from_monthly: trip.exclude_from_monthly, transactions_tagged: s.transactions.length, spent_so_far: s.spent };
      }
      case "trip_status": {
        const a = parsed.data as z.infer<typeof schemas.trip_status>;
        const trip = findTrip(await store.select("trips"), a.trip);
        if (!trip) return { error: a.trip ? `No trip called "${a.trip}"` : "No trips yet" };
        const s = await tripSummary(store, trip.id);
        return {
          trip: s.trip.name,
          dates: `${s.trip.start_date} → ${s.trip.end_date}`,
          status: s.status,
          spent: s.spent,
          budget: s.budget,
          remaining: s.remaining,
          days_elapsed: s.days_elapsed,
          days_left: s.days_left,
          daily_average: s.daily_average,
          remaining_per_day: s.remaining_per_day,
          by_category: s.by_category.slice(0, 6),
          transactions: s.transactions.length,
        };
      }
      case "set_weekly_cap": {
        const a = parsed.data as z.infer<typeof schemas.set_weekly_cap>;
        const r = await setWeeklyCap(store, a.category, a.amount);
        return { ok: true, ...r };
      }
      case "weekly_status": {
        const a = parsed.data as z.infer<typeof schemas.weekly_status>;
        const w = await weeklyCapStatus(store);
        if (!a.category) return w;
        const cats = await store.select("categories");
        const cat = requireCategory(cats, a.category);
        const cap = w.caps.find((c) => c.category_id === cat.id);
        const range = { from: w.week_start, to: todayLocal() };
        const q = await querySpending(store, { ...range, category: cat.id });
        return { week_start: w.week_start, week_end: w.week_end, days_left: w.days_left, category: cat.name, spent_this_week: q.total_spent, weekly_cap: cap?.cap ?? null, remaining: cap?.remaining ?? null, pct: cap?.pct ?? null, level: cap?.level ?? "no cap" };
      }
      case "list_subscriptions": {
        const r = await listSubscriptions(store);
        return {
          monthly_total: r.monthly_total,
          subscriptions: r.subscriptions.filter((x) => !x.lapsed).map((x) => ({ name: clip(x.name), amount: x.amount, frequency: x.frequency, next_expected: x.next_expected, monthly_equivalent: x.monthly_equivalent, price_increase: x.price_increase, is_new: x.is_new, missed: x.missed })),
        };
      }
    }
  } catch (err) {
    if (err instanceof UserError) return { error: err.message };
    throw err;
  }
}

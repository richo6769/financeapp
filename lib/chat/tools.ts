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
import { matchAndLink } from "@/lib/reimburse";

const period = z.enum(["weekly", "fortnightly", "monthly", "yearly"]);
const presets = z.enum([
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
  get_budget_status: z.object({
    month: z.string().optional().describe("YYYY-MM. Defaults to the current month."),
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
        return await budgetStatus(store, a.month);
      }
    }
  } catch (err) {
    if (err instanceof UserError) return { error: err.message };
    throw err;
  }
}

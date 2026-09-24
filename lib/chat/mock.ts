import "server-only";
import type { ChatMessage, ToolCallRecord } from "@/lib/types";
import { formatNZD } from "@/lib/money";
import { findCategory } from "@/lib/services";
import { executeTool, type ToolContext } from "./tools";

/**
 * Offline stand-in for Claude, used when ANTHROPIC_API_KEY is missing. It
 * pattern-matches common requests and calls the *same* tools as the real
 * model, so the whole tool layer can be tested without a key. Claude handles
 * far more phrasing once a key is added.
 */

type R = Record<string, unknown>;

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, six: 6, twelve: 12 };
const SYNONYMS: Record<string, string> = {
  rent: "Rent/Housing",
  housing: "Rent/Housing",
  mortgage: "Rent/Housing",
  food: "Groceries",
  grocery: "Groceries",
  takeaways: "Eating Out",
  restaurants: "Eating Out",
  petrol: "Fuel",
  gas: "Fuel",
  gym: "Health/Fitness",
  power: "Utilities",
  bills: "Utilities",
};

const CASH_HINTS: [RegExp, string][] = [
  [/coffee|lunch|dinner|breakfast|pizza|kebab|takeaway|cafe|bakery/, "Eating Out"],
  [/grocer|dairy|milk|bread|market/, "Groceries"],
  [/bus|taxi|parking|ferry/, "Transport"],
  [/petrol|fuel/, "Fuel"],
  [/doctor|physio|gym|pharmacy/, "Health/Fitness"],
  [/movie|cinema|concert|ticket/, "Entertainment"],
];

export async function runMockPlanner(
  ctx: ToolContext,
  history: ChatMessage[],
  text: string,
): Promise<{ reply: string; tool_calls: ToolCallRecord[] }> {
  const calls: ToolCallRecord[] = [];
  const call = async (name: string, input: R): Promise<R> => {
    const result = await executeTool(ctx, name, input);
    calls.push({ name, input, result });
    return result;
  };
  const done = (reply: string) => ({
    reply: `${reply}\n\n_(Offline assistant — add ANTHROPIC_API_KEY for full natural-language chat.)_`,
    tool_calls: calls,
  });
  const cats = await ctx.store.select("categories");
  const catFor = (phrase: string) => {
    const p = phrase
      .toLowerCase()
      .replace(/\b(my|the|a|an|budget|spending|on|for|is|of)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return findCategory(cats, SYNONYMS[p] ?? p);
  };
  const t = text.trim();
  const lower = t.toLowerCase();

  // --- Confirmation of a pending action
  if (/^(yes|yep|yeah|y|confirm|go ahead|do it|ok|okay|sure)\b/.test(lower)) {
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    const pending = lastAssistant?.tool_calls?.find((c) => (c.result as R)?.needs_confirmation);
    if (!pending) return done("There's nothing waiting for confirmation.");
    const r = await call(pending.name, {
      ...(pending.input as R),
      confirmed: true,
      confirmation_token: (pending.result as R).confirmation_token,
    });
    if (r.error) return done(`That didn't work: ${r.error}`);
    return done(`Done ✅ ${summarise(pending.name, r)}`);
  }
  if (/^(no|nope|cancel|stop)\b/.test(lower)) return done("No worries — nothing was changed.");

  // --- Rules: "Anything from Z Energy or BP is Fuel"
  let m = t.match(/^(?:anything|everything|all)\s+(?:from|at)\s+(.+?)\s+(?:is|are|goes? (?:in|to)|should be)\s+(.+?)\.?$/i);
  if (m) {
    const merchants = m[1].split(/\s*(?:,|\bor\b|\band\b)\s*/i).filter(Boolean);
    const cat = catFor(m[2]);
    if (!cat) return done(`I couldn't find a category called "${m[2]}".`);
    const lines: string[] = [];
    for (const merchant of merchants) {
      const r = await call("create_rule", { pattern: merchant, category: cat.name });
      if (r.needs_confirmation) lines.push(`• ${merchant} → ${cat.name}: would change ${(r.preview as R).past_transactions_that_would_change} past transactions. Reply "yes" to confirm.`);
      else lines.push(`• ${merchant} → ${cat.name} (${r.past_transactions_recategorised ?? 0} past transactions updated)`);
    }
    return done(`Rules created:\n${lines.join("\n")}`);
  }

  // --- Cash: "I paid 40 cash for a haircut yesterday"
  m = t.match(/(?:paid|spent)\s+\$?(\d+(?:\.\d{1,2})?)\s+(?:in\s+)?cash\s+(?:for|on)\s+(?:a\s+|an\s+|some\s+)?(.+?)(?:\s+(yesterday|today|on \d{4}-\d{2}-\d{2}))?\.?$/i);
  if (m) {
    const what = m[2].trim();
    const hint = CASH_HINTS.find(([re]) => re.test(what.toLowerCase()))?.[1] ?? "Other";
    const r = await call("add_manual_transaction", {
      description: `${what[0].toUpperCase()}${what.slice(1)} (cash)`,
      amount: Number(m[1]),
      date: m[3]?.replace(/^on /, "") ?? "today",
      category: hint,
    });
    if (r.error) return done(`Couldn't add it: ${r.error}`);
    return done(`Added a cash expense: ${r.description}, ${formatNZD(Math.abs(r.amount as number))} on ${r.date} in ${r.category}.`);
  }

  // --- On track?
  if (/on track|budget status|how am i doing|how'?s my budget/.test(lower)) {
    const s = await call("get_budget_status", {});
    return done(describeStatus(s));
  }

  // --- Spending query: "How much have I spent on Uber Eats in the last 3 months?"
  m = t.match(/how much (?:have i|did i|i've)?\s*(?:spent|spend)\s+(?:on|at)\s+(.+?)(?:\s+(?:in|over|during)\s+(?:the\s+)?(last|past)\s+(\d+|one|two|three|six|twelve)\s+months?|\s+(this month|last month|this year))?\s*\??$/i);
  if (m) {
    const target = m[1].trim();
    const n = m[3] ? (WORD_NUM[m[3].toLowerCase()] ?? Number(m[3])) : undefined;
    const period =
      n === 1 ? "last_month" : n === 3 ? "last_3_months" : n === 6 ? "last_6_months" : n === 12 ? "last_12_months"
      : m[4]?.toLowerCase() === "last month" ? "last_month"
      : m[4]?.toLowerCase() === "this year" ? "year_to_date"
      : n ? "last_12_months" : "this_month";
    const cat = catFor(target);
    const r = await call("query_spending", cat ? { category: cat.name, period } : { merchant: target, period });
    const months = (r.by_month as { month: string; spent: number }[]).map((x) => `• ${x.month}: ${formatNZD(x.spent)}`).join("\n");
    return done(
      `You've spent **${formatNZD(r.total_spent as number)}** on ${cat?.name ?? target} (${r.from} → ${r.to}) across ${r.transaction_count} transactions.${months ? `\n${months}` : ""}`,
    );
  }

  // --- Delete category
  m = t.match(/^(?:delete|remove)\s+(?:the\s+)?(.+?)\s+category\.?$/i) ?? t.match(/^(?:delete|remove)\s+category\s+(.+?)\.?$/i);
  if (m) {
    const r = await call("delete_category", { category: m[1] });
    if (r.error) return done(String(r.error));
    const p = r.preview as R;
    return done(`Deleting **${p.category}** will uncategorise ${p.transactions_affected} transactions and remove ${p.rules_removed} rules and ${p.budgets_removed} budgets. Reply "yes" to confirm.`);
  }

  // --- Create category
  m = t.match(/^(?:create|add|make)\s+(?:a\s+)?(?:new\s+)?(?:sub)?category\s+(?:called\s+)?"?(.+?)"?(?:\s+under\s+(.+?))?\.?$/i);
  if (m) {
    const r = await call("create_category", { name: m[1], parent: m[2] });
    return done(r.error ? String(r.error) : `Created category **${r.category}**${m[2] ? ` under ${m[2]}` : ""}.`);
  }

  // --- Rename
  m = t.match(/^rename\s+(.+?)\s+to\s+(.+?)\.?$/i);
  if (m) {
    const r = await call("update_category", { category: m[1], new_name: m[2] });
    return done(r.error ? String(r.error) : `Renamed to **${r.category}**.`);
  }

  // --- Recategorise: "move all Uber trips to Transport"
  m = t.match(/^(?:move|recategori[sz]e|put)\s+(?:all\s+)?(?:my\s+)?(.+?)\s+(?:transactions\s+)?(?:to|into|under)\s+(.+?)\.?$/i);
  if (m) {
    const r = await call("recategorise_transactions", { merchant: m[1], new_category: m[2], create_rule: true });
    if (r.error) return done(String(r.error));
    if (r.needs_confirmation) {
      const p = r.preview as R;
      return done(`That would move ${p.transactions_that_would_move} transactions to ${p.to_category}. Reply "yes" to confirm.`);
    }
    return done(`Moved ${r.updated} transactions to ${r.to_category}.${r.rule_created ? ` Rule added: ${r.rule_created}.` : ""}`);
  }

  // --- Budgets: "My rent is 450 a week, groceries budget 600 a month, eating out 300"
  const clauses = t.split(/\s*(?:,|;|\band\b|\.\s)\s*/i).filter(Boolean);
  const budgetRe = /^(?:set\s+)?(.+?)\s+(?:budget\s+)?(?:is\s+|to\s+|of\s+|at\s+|=\s*)?\$?(\d+(?:\.\d{1,2})?)\s*(?:(?:a|per|each|every|\/)\s*(week|fortnight|month|year))?\.?$/i;
  const parsed = clauses.map((c) => c.match(budgetRe)).filter(Boolean) as RegExpMatchArray[];
  if (parsed.length && parsed.length === clauses.length) {
    const lines: string[] = [];
    for (const b of parsed) {
      const phrase = b[1];
      const overall = /\b(overall|total|everything)\b/i.test(phrase);
      const periodWord = (b[3] ?? "month").toLowerCase();
      const period = periodWord === "week" ? "weekly" : periodWord === "fortnight" ? "fortnightly" : periodWord === "year" ? "yearly" : "monthly";
      const cat = overall ? undefined : catFor(phrase);
      if (!overall && !cat) {
        lines.push(`• "${phrase}": no matching category (create it first)`);
        continue;
      }
      const r = await call("set_budget", overall ? { overall: true, amount: Number(b[2]), period } : { category: cat!.name, amount: Number(b[2]), period });
      lines.push(r.error ? `• ${phrase}: ${r.error}` : `• ${overall ? "Overall cap" : r.category}: ${r.conversion}`);
    }
    return done(`Budgets updated:\n${lines.join("\n")}`);
  }

  return done(
    `I can help with things like:\n• "My rent is 450 a week, groceries budget 600 a month"\n• "Anything from Z Energy or BP is Fuel"\n• "I paid 40 cash for a haircut yesterday"\n• "How much have I spent on Uber Eats in the last 3 months?"\n• "Am I on track this month?"`,
  );
}

function summarise(name: string, r: R): string {
  switch (name) {
    case "delete_category":
      return `Deleted ${(r.deleted as R)?.category}.`;
    case "create_rule":
      return `Rule ${r.rule} created; ${r.past_transactions_recategorised} past transactions updated.`;
    case "recategorise_transactions":
      return `Moved ${r.updated} transactions to ${r.to_category}.`;
    default:
      return "";
  }
}

function describeStatus(s: R): string {
  const cats = (s.categories as R[]).filter((c) => c.budget != null);
  const over = cats.filter((c) => c.status === "over budget");
  const ahead = cats.filter((c) => c.status === "ahead of pace");
  const capped = s.overall_cap != null;
  const measured = formatNZD((capped ? s.total_spent : s.budgeted_categories_spent) as number);
  const limit = formatNZD((capped ? s.overall_cap : s.total_of_category_budgets) as number);
  const scope = capped ? "against your overall cap" : "across your budgeted categories";
  const head =
    s.on_track == null
      ? `You've spent ${formatNZD(s.total_spent as number)} so far in ${s.month_label} (no budgets set yet).`
      : s.on_track
        ? `Yes — you're on track: ${measured} of ${limit} ${scope}, ${s.days_left} days left (${formatNZD(s.remaining as number)} remaining).`
        : `Not quite — ${measured} of ${limit} ${scope} with ${s.days_left} days left. Total spending this month is ${formatNZD(s.total_spent as number)}.`;
  const lines = [
    ...over.map((c) => `• 🔴 ${c.name}: ${formatNZD(c.spent as number)} of ${formatNZD(c.budget as number)}`),
    ...ahead.map((c) => `• 🟠 ${c.name}: ${formatNZD(c.spent as number)} of ${formatNZD(c.budget as number)} (ahead of pace)`),
  ];
  return `${head}${lines.length ? `\n${lines.join("\n")}` : ""}`;
}

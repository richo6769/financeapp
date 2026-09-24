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
  housing: "Rent",
  mortgage: "Rent",
  food: "Groceries",
  grocery: "Groceries",
  takeaway: "Takeaways",
  restaurants: "Eating Out",
  pubs: "Bars",
  drinks: "Bars",
  booze: "Liquor Stores",
  alcohol: "Liquor Stores",
  liquor: "Liquor Stores",
  petrol: "Transport/Fuel",
  gas: "Transport/Fuel",
  gym: "Health & Wellness",
  power: "Bills",
  utilities: "Bills",
  clothes: "Clothes/Shopping",
  income: "Salary",
  pay: "Salary",
};

const CASH_HINTS: [RegExp, string][] = [
  [/coffee|lunch|dinner|breakfast|cafe|bakery/, "Eating Out"],
  [/pizza|kebab|takeaway|fish and chips|burger/, "Takeaways"],
  [/beer|drinks|bar|pub/, "Bars"],
  [/grocer|dairy|milk|bread|market/, "Groceries"],
  [/bus|taxi|parking|ferry|petrol|fuel/, "Transport/Fuel"],
  [/haircut|barber|doctor|physio|gym|pharmacy|massage/, "Health & Wellness"],
  [/movie|cinema|concert|ticket/, "Entertainment"],
  [/golf|footy|rugby|cricket|squash|tennis/, "Sports"],
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

  // --- Choice after link_reimbursement needs_choice: "1" / "2 1" / "expense 2 payment 1"
  const lastA = [...history].reverse().find((m) => m.role === "assistant");
  const choice = lastA?.tool_calls?.find((c) => (c.result as R)?.needs_choice);
  const nums = lower.match(/^\s*(?:expense\s*)?(\d+)(?:\s*(?:,|and)?\s*(?:payment\s*)?(\d+))?\s*$/);
  if (choice && nums && choice.name === "create_iou") {
    const cands = (choice.result as { expense_candidates: { id: string }[] }).expense_candidates;
    const e = cands[Number(nums[1]) - 1];
    if (!e) return done("That number isn't in the list.");
    const r = await call("create_iou", { ...(choice.input as R), expense_id: e.id });
    if (r.error) return done(`Couldn't add that: ${r.error}`);
    return done(`Noted: ${r.person} owes you ${formatNZD(r.amount as number)} for ${r.expense} (${r.expense_date}).`);
  }
  if (choice && nums && choice.name === "link_reimbursement") {
    const res = choice.result as { expense_candidates: { id: string }[]; income_candidates: { id: string }[] };
    const multiE = res.expense_candidates.length > 1;
    const multiI = res.income_candidates.length > 1;
    const first = Number(nums[1]) - 1;
    const second = nums[2] ? Number(nums[2]) - 1 : 0;
    const e = multiE ? res.expense_candidates[first] : res.expense_candidates[0];
    // Only one number while both lists were ambiguous: it picks the expense;
    // the payment is re-resolved now the share is known (may ask again).
    const i = !multiI ? res.income_candidates[0] : multiE ? (nums[2] ? res.income_candidates[second] : undefined) : res.income_candidates[first];
    if (!e || (!i && !(multiE && multiI && !nums[2]))) return done("That number isn't in the list.");
    const r = await call("link_reimbursement", { ...(choice.input as R), expense_id: e.id, ...(i ? { income_id: i.id } : {}) });
    return done(describeLink(r));
  }

  // --- Net off: "The $100 from Sam was for Snus Direct"
  let m = t.match(/^(?:the\s+)?\$?(\d+(?:\.\d{1,2})?)\s+(?:from|that)\s+(.+?)\s+(?:was|is|paid)\s+(?:for|towards|me back for)\s+(?:the\s+|my\s+)?(.+?)\.?$/i);
  if (m) {
    const r = await call("link_reimbursement", { income_amount: Number(m[1]), income_from: m[2], expense: stripMeal(m[3]) });
    return done(describeLink(r));
  }
  // --- Net off: "Jack paid me back half of dinner at Soul Bar" / "Sam paid me back $50 for Snus Direct"
  m = t.match(/^(.+?)\s+paid\s+me\s+back\s+(half|a third|a quarter|all|\$?\d+(?:\.\d{1,2})?)\s+(?:of|for)\s+(?:the\s+|my\s+)?(.+?)\.?$/i);
  if (m) {
    const share = m[2].toLowerCase();
    const fraction = share === "half" ? 0.5 : share === "a third" ? 1 / 3 : share === "a quarter" ? 0.25 : share === "all" ? 1 : undefined;
    const r = await call("link_reimbursement", {
      income_from: m[1],
      expense: stripMeal(m[3]),
      ...(fraction != null ? { fraction } : { amount: Number(share.replace("$", "")) }),
    });
    return done(describeLink(r));
  }

  // --- IOUs: "Sam owes me 100 for Snus Direct" / "Sam owes me $50"
  m = t.match(/^(.+?)\s+owes\s+me\s+\$?(\d+(?:\.\d{1,2})?)(?:\s+(?:for|on)\s+(?:the\s+|my\s+)?(.+?))?\.?$/i);
  if (m && !/^who\b/i.test(m[1])) {
    if (!m[3]) return done("Which expense is that for? e.g. \"Sam owes me 100 for Snus Direct\".");
    const r = await call("create_iou", { person: m[1].trim(), amount: Number(m[2]), expense: stripMeal(m[3]) });
    if (r.error) return done(`Couldn't add that: ${r.error}`);
    if (r.needs_choice) return done(listChoices(r.expense_candidates as R[], "Which expense?"));
    return done(`Noted: ${r.person} owes you ${formatNZD(r.amount as number)} for ${r.expense} (${r.expense_date}). It'll settle automatically when you net off their payment.`);
  }
  if (/^who\s+owes\s+me|what\s+am\s+i\s+owed|owed\s+to\s+me/i.test(lower)) {
    const r = await call("list_ious", {});
    const people = r.people as { person: string; total: number; oldest_days: number }[];
    if (!people.length) return done("Nobody owes you anything right now.");
    return done(`You're owed **${formatNZD(r.total_owed as number)}**:\n${people.map((p) => `• ${p.person}: ${formatNZD(p.total)} (oldest ${p.oldest_days} days)`).join("\n")}`);
  }
  m = t.match(/^cancel\s+(?:the\s+)?(.+?)(?:'s)?\s+iou(?:\s+(?:for|on)\s+(.+?))?\.?$/i);
  if (m) {
    const r = await call("cancel_iou", { person: m[1], expense: m[2] ? stripMeal(m[2]) : undefined });
    if (r.error) return done(String(r.error));
    if (r.needs_choice) return done(`More than one IOU matches: ${(r.iou_candidates as R[]).map((c) => `${c.person} ${formatNZD(c.balance as number)} (${c.expense})`).join("; ")}. Say which expense.`);
    const c = r.cancelled as R;
    return done(`Cancelled ${c.person}'s IOU of ${formatNZD(c.amount as number)}.`);
  }

  // --- Trips: "create a trip SEA trip from 26 Dec to 17 Jan, budget 5000"
  m = t.match(/^(?:create|add|start|plan)\s+(?:a\s+)?(?:new\s+)?trip\s+(?:called\s+)?"?(.+?)"?\s+from\s+(.+?)\s+(?:to|until|till|-)\s+(.+?)(?:,?\s+(?:with\s+a\s+)?budget(?:\s+of)?\s+\$?(\d+(?:\.\d{1,2})?))?\.?$/i);
  if (m) {
    const r = await call("create_trip", { name: m[1], start_date: m[2], end_date: m[3], ...(m[4] ? { budget: Number(m[4]) } : {}) });
    if (r.error) return done(`Couldn't create the trip: ${r.error}`);
    return done(`Trip **${r.trip}** set up (${r.start_date} → ${r.end_date}${r.budget != null ? `, budget ${formatNZD(r.budget as number)}` : ""}). ${r.transactions_tagged} transactions tagged so far (${formatNZD(r.spent_so_far as number)}). Trip spending is kept out of your monthly budgets.`);
  }
  if (/trip/.test(lower) && /how|status|spend|going|tracking/.test(lower)) {
    const r = await call("trip_status", {});
    if (r.error) return done(String(r.error));
    return done(
      `**${r.trip}** (${r.status}): ${formatNZD(r.spent as number)} spent${r.budget != null ? ` of ${formatNZD(r.budget as number)} — ${formatNZD(r.remaining as number)} left` : ""}. Averaging ${formatNZD(r.daily_average as number)}/day${r.remaining_per_day != null ? `; ${formatNZD(r.remaining_per_day as number)}/day available for the ${r.days_left} days left` : ""}.`,
    );
  }

  // --- Weekly caps: "cap bars at 80 a week" / "how am I tracking on liquor this week?"
  m = t.match(/^(?:set\s+(?:a\s+)?)?(?:weekly\s+)?cap\s+(?:for\s+|on\s+)?(.+?)\s+(?:at|to)\s+\$?(\d+(?:\.\d{1,2})?)(?:\s*(?:a|per|\/)\s*week)?\.?$/i);
  if (m) {
    const cat = catFor(m[1]);
    if (!cat) return done(`I couldn't find a category called "${m[1]}".`);
    const r = await call("set_weekly_cap", { category: cat.name, amount: Number(m[2]) });
    return done(r.error ? String(r.error) : `Weekly cap set: ${r.category} ${formatNZD(r.amount as number)} per week (Mon–Sun). I'll warn you at 80% and 100%.`);
  }
  m = t.match(/how\s+am\s+i\s+(?:tracking|going|doing)\s+on\s+(.+?)\s+this\s+week\??$/i);
  if (m) {
    const cat = catFor(m[1]);
    if (!cat) return done(`I couldn't find a category called "${m[1]}".`);
    const r = await call("weekly_status", { category: cat.name });
    if (r.error) return done(String(r.error));
    return done(
      r.weekly_cap != null
        ? `${r.category} this week: ${formatNZD(r.spent_this_week as number)} of your ${formatNZD(r.weekly_cap as number)} cap (${r.pct}%), ${formatNZD(r.remaining as number)} left with ${r.days_left} days to go.`
        : `${r.category} this week: ${formatNZD(r.spent_this_week as number)} so far (no weekly cap set).`,
    );
  }
  if (/subscriptions?/.test(lower) && /what|which|list|show|my/.test(lower)) {
    const r = await call("list_subscriptions", {});
    const subs = r.subscriptions as R[];
    return done(`${subs.length} recurring charges, ${formatNZD(r.monthly_total as number)}/month:\n${subs.slice(0, 10).map((x) => `• ${x.name}: ${formatNZD(x.amount as number)} ${x.frequency}`).join("\n")}`);
  }

  // --- Rules: "Anything from Z Energy or BP is Fuel"
  m = t.match(/^(?:anything|everything|all)\s+(?:from|at)\s+(.+?)\s+(?:is|are|goes? (?:in|to)|should be)\s+(.+?)\.?$/i);
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

/** "dinner at Soul Bar" → "Soul Bar" */
function stripMeal(s: string): string {
  const at = s.match(/\b(?:at|from)\s+(.+)$/i);
  return (at ? at[1] : s).trim();
}

function describeLink(r: R): string {
  if (r.error) return `Couldn't net that off: ${r.error}`;
  if (r.needs_choice) {
    const e = r.expense_candidates as { date: string; description: string; amount: number }[];
    const i = r.income_candidates as { date: string; description: string; amount: number; remaining: number }[];
    const lines: string[] = ["More than one transaction matches — which one?"];
    if (e.length > 1) {
      lines.push("**Expense:**", ...e.map((x, n) => `${n + 1}. ${x.date} ${x.description} ${formatNZD(Math.abs(x.amount))}`));
    }
    if (i.length > 1) {
      lines.push("**Payment:**", ...i.map((x, n) => `${n + 1}. ${x.date} ${x.description} ${formatNZD(x.amount)} (${formatNZD(x.remaining)} unallocated)`));
    }
    lines.push(e.length > 1 && i.length > 1 ? 'Reply with two numbers, e.g. "1 2" (expense, payment).' : 'Reply with the number.');
    return lines.join("\n");
  }
  return `Netted off ${formatNZD(r.linked as number)}: ${r.expense}. From ${r.income}.`;
}

function listChoices(cands: R[], q: string): string {
  return [q, ...cands.map((c, i) => `${i + 1}. ${c.date} ${c.description} ${formatNZD(Math.abs(c.amount as number))}`)].join("\n");
}

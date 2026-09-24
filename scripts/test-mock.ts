/**
 * End-to-end test of sync + categorisation + chatbot tools against mock
 * Akahu data and a throwaway local store. No keys needed.
 *   npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalStore } from "@/lib/store/local";
import { DEFAULT_RULES, ensureSeeded } from "@/lib/seed";
import { MockAkahuClient } from "@/lib/akahu/mock";
import { runSync } from "@/lib/sync";
import { addDays, todayLocal, resolvePeriod } from "@/lib/dates";
import {
  budgetStatus,
  dashboard,
  findTransactions,
  setBudget,
  setTransactionCategory,
  spendingByCategory,
  spendOf,
  BULK_CONFIRM_THRESHOLD,
} from "@/lib/services";
import { describeNet, linkReimbursement, unlinkReimbursement } from "@/lib/reimburse";
import { executeTool, TOOL_DEFS } from "@/lib/chat/tools";
import { runMockPlanner } from "@/lib/chat/mock";
import { priorTokensFrom } from "@/lib/chat/agent";
import type { ChatMessage } from "@/lib/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "financeapp-test-"));
const store = new LocalStore("test-user", path.join(dir, "db.json"));
let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

async function main() {
  await ensureSeeded(store);
  const cats = await store.select("categories");
  const cat = (n: string) => cats.find((c) => c.name === n)!;
  assert.equal(cats.length, 19);
  assert.deepEqual(
    cats.filter((c) => c.kind === "expense").map((c) => c.name).sort(),
    ["Bars", "Bills", "Clothes/Shopping", "Eating Out", "Entertainment", "Groceries", "Health & Wellness", "Home Supplies",
      "Insurance", "Liquor Stores", "Other", "Rent", "Sports", "Subscriptions", "Takeaways", "Transport/Fuel", "Travel"],
  );
  assert.deepEqual(cats.filter((c) => c.kind === "income").map((c) => c.name), ["Salary"]);
  assert.deepEqual(cats.filter((c) => c.kind === "transfer").map((c) => c.name), ["Transfers"]);
  const seededRules = await store.select("rules");
  assert.equal(seededRules.length, DEFAULT_RULES.length);
  const prio = (p: string) => seededRules.find((r) => r.pattern === p)!.priority;
  assert.ok(prio("uber eats") < prio("uber"), "uber eats must beat uber");
  const seedSql = fs.readFileSync("supabase/migrations/20260924000100_seed_defaults.sql", "utf8");
  for (const c of cats) assert.ok(seedSql.includes(`'${c.name}'`), `seed SQL missing category ${c.name}`);
  for (const r of DEFAULT_RULES) assert.ok(seedSql.includes(`'${r.pattern}'`), `seed SQL missing rule ${r.pattern}`);
  ok(`seeded 19 categories (17 expense, Salary, Transfers) + ${DEFAULT_RULES.length} starter rules; seed SQL in sync`);

  // ------------------------------------------------------------------ sync
  console.log("Sync");
  const client = new MockAkahuClient();
  const first = await runSync(store, client, "test");
  assert.equal(first.status, "success", first.error ?? "");
  assert.equal(first.accounts_synced, 3);
  assert.ok(first.transactions_new > 500, `backfill too small: ${first.transactions_new}`);
  const all1 = await store.select("transactions");
  const oldest = all1.map((t) => t.local_date).sort()[0];
  assert.ok(oldest <= addDays(todayLocal(), -360), `backfill should reach ~12 months, oldest=${oldest}`);
  ok(`first sync backfilled ${first.transactions_new} txns from ${oldest} (3 accounts, cursor-paginated)`);

  const second = await runSync(store, client, "test");
  const all2 = await store.select("transactions");
  assert.equal(second.transactions_new, 0);
  assert.equal(all2.length, all1.length);
  assert.ok(second.range_start! > first.range_start!, "second sync should be incremental");
  ok(`re-sync is incremental from ${second.range_start} and creates no duplicates`);

  const ids = new Set(all2.map((t) => t.akahu_id));
  assert.equal(ids.size, all2.length);
  ok("akahu_id unique across all rows");

  // Pending replacement: advance the clock two days -> old pending settle.
  const pendingBefore = await store.select("pending_transactions");
  assert.ok(pendingBefore.length > 0);
  const future = new MockAkahuClient(() => new Date(Date.now() + 2 * 86_400_000));
  // Settled data is capped at "today" by the sync range end, so emulate by
  // checking the pending set is replaced (not appended) on each sync.
  await runSync(store, future, "test");
  const pendingAfter = await store.select("pending_transactions");
  assert.ok(pendingAfter.every((p) => p.local_date >= addDays(todayLocal(), 0)), "pending set replaced by future dates");
  assert.ok(!pendingAfter.some((p) => pendingBefore.some((b) => b.id === p.id)));
  const settledNow = await store.select("transactions", { gte: { local_date: addDays(todayLocal(), -1) } });
  assert.ok(settledNow.length > 0, "yesterday's pending settled into transactions");
  ok(`pending replaced (${pendingBefore.length} → ${pendingAfter.length}); previously pending items settled with ids`);

  // ------------------------------------------------------- categorisation
  console.log("Categorisation");
  const txns = await store.select("transactions");
  const amexPayments = txns.filter((t) => t.description === "AMERICAN EXPRESS NZ PAYMENT");
  const amexCredits = txns.filter((t) => t.description === "PAYMENT RECEIVED - THANK YOU");
  const sweeps = txns.filter((t) => t.description.startsWith("TRANSFER "));
  assert.ok(amexPayments.length >= 11 && amexPayments.every((t) => t.is_transfer && t.category_id === cat("Transfers").id));
  assert.ok(amexCredits.every((t) => t.is_transfer));
  assert.ok(sweeps.length > 10 && sweeps.every((t) => t.is_transfer), "ANZ ↔ savings transfers");
  assert.ok([...amexPayments, ...amexCredits, ...sweeps].every((t) => spendOf(t, cats) === 0));
  ok(`${amexPayments.length} Amex repayments + ${amexCredits.length} card credits + ${sweeps.length} savings transfers tagged Transfers and excluded from spend`);

  const expectRule = (desc: string, category: string) => {
    const rows = txns.filter((t) => t.description.startsWith(desc));
    assert.ok(rows.length > 0, `no mock rows for ${desc}`);
    assert.ok(
      rows.every((t) => t.category_id === cat(category).id && t.category_source === "rule"),
      `${desc} → ${category}: got ${rows.map((t) => `${t.category_id}/${t.category_source}`)[0]}`,
    );
  };
  expectRule("Z ENERGY", "Transport/Fuel");
  expectRule("MOBIL", "Transport/Fuel");
  expectRule("AT HOP", "Transport/Fuel");
  expectRule("UBER *EATS", "Takeaways");
  expectRule("UBER *TRIP", "Transport/Fuel");
  expectRule("MCDONALDS", "Takeaways");
  expectRule("SUPER LIQUOR", "Liquor Stores");
  expectRule("AA INSURANCE", "Insurance");
  expectRule("SOUTHERN CROSS", "Insurance");
  expectRule("BUNNINGS", "Home Supplies");
  expectRule("HALLENSTEIN", "Clothes/Shopping");
  expectRule("MERCURY", "Bills");
  expectRule("SPARK", "Bills");
  expectRule("LES MILLS", "Health & Wellness");
  expectRule("APPLE.COM", "Subscriptions");
  ok("starter rules: Uber Eats → Takeaways beats Uber → Transport/Fuel; liquor, insurance, bills, home, clothes …");

  const expectHint = (desc: string, category: string) => {
    const rows = txns.filter((t) => t.description.startsWith(desc));
    assert.ok(rows.length > 0, `no mock rows for ${desc}`);
    assert.ok(rows.every((t) => t.category_id === cat(category).id && t.category_source === "akahu"), `${desc} → ${category}`);
  };
  expectHint("SOUL BAR", "Bars");
  expectHint("HELL PIZZA", "Takeaways");
  expectHint("COFFEE SUPREME", "Eating Out");
  expectHint("REBEL SPORT", "Sports");
  expectHint("BURGER BURGER", "Eating Out");
  const salary = txns.filter((t) => t.description === "ACME LIMITED SALARY");
  assert.ok(salary.length > 0 && salary.every((t) => t.category_id === cat("Salary").id && spendOf(t, cats) === 0));
  ok("Akahu hints: pubs/bars → Bars, takeaway → Takeaways, cafes → Eating Out, sport → Sports, salary → Salary");

  const refunds = txns.filter((t) => t.description.includes("REFUND"));
  if (refunds.length) {
    assert.ok(refunds.every((t) => t.category_id === cat("Clothes/Shopping").id && spendOf(t, cats) < 0));
    ok(`${refunds.length} refunds count as negative spend in Clothes/Shopping`);
  }

  const rent = txns.filter((t) => t.description === "J SMITH PROPERTY RENT");
  assert.ok(rent.length > 40 && rent.every((t) => !t.category_id), "rent starts uncategorised");
  ok("unknown payees land in the Uncategorised inbox");

  // Inline recategorise with "apply to all from this merchant".
  const res = await setTransactionCategory(store, rent[0].id, cat("Rent").id, true);
  assert.equal(res.updated, rent.length);
  const rules = await store.select("rules");
  assert.ok(rules.some((r) => r.category_id === cat("Rent").id && "j smith property rent".includes(r.pattern)));
  ok(`inline recategorise applied to ${res.updated} rent payments and created rule ${res.rule}`);

  // New rule applies on next sync to new rows (simulate by clearing one row).
  const [victim] = await store.select("transactions", { eq: { description: "J SMITH PROPERTY RENT" } }, { limit: 1 });
  await store.remove("transactions", { eq: { id: victim.id } });
  await runSync(store, client, "test", { full: true });
  const [back] = await store.select("transactions", { eq: { akahu_id: victim.akahu_id } });
  assert.equal(back.category_id, cat("Rent").id);
  assert.equal(back.category_source, "rule");
  ok("rules auto-apply to newly synced transactions");

  // Manual choices survive re-sync.
  const [coffee] = await store.select("transactions", { eq: { description: "COFFEE SUPREME PONSONBY" } }, { limit: 1 });
  await setTransactionCategory(store, coffee.id, cat("Entertainment").id, false);
  await runSync(store, client, "test", { full: true });
  const [coffee2] = await store.select("transactions", { eq: { id: coffee.id } });
  assert.equal(coffee2.category_id, cat("Entertainment").id);
  ok("manual categorisation is never overwritten by sync");

  // ------------------------------------------------------------ chat tools
  console.log("Chatbot tools (offline planner → real tool layer)");
  assert.equal(TOOL_DEFS.length, 10);
  assert.ok(TOOL_DEFS.every((t) => t.input_schema.type === "object"));
  ok("10 tool definitions with object JSON schemas");

  const history: ChatMessage[] = [];
  const say = async (text: string) => {
    const r = await runMockPlanner({ store, priorTokens: priorTokensFrom(history) }, history, text);
    const now = new Date().toISOString();
    history.push({ id: String(history.length), user_id: "test-user", role: "user", content: text, tool_calls: null, created_at: now });
    history.push({ id: String(history.length), user_id: "test-user", role: "assistant", content: r.reply, tool_calls: r.tool_calls, created_at: now });
    return r;
  };

  let r = await say("My rent is 450 a week, groceries budget 600 a month, eating out 300");
  const budgets = await store.select("budgets");
  const b = (n: string) => budgets.find((x) => x.category_id === cat(n).id);
  assert.equal(b("Rent")?.amount_monthly, 1950);
  assert.equal(b("Rent")?.period, "weekly");
  assert.equal(b("Groceries")?.amount_monthly, 600);
  assert.equal(b("Eating Out")?.amount_monthly, 300);
  assert.match(r.reply, /\$450\.00\/week × 52 ÷ 12 = \$1,950\.00\/month/);
  ok("budgets: rent 450/wk → $1,950/month (conversion shown), groceries 600, eating out 300");

  r = await say("Anything from Z Energy or BP is Fuel");
  const rules2 = await store.select("rules");
  assert.ok(rules2.some((x) => x.pattern.toLowerCase() === "bp" && x.category_id === cat("Transport/Fuel").id));
  assert.ok(r.reply.includes("Transport/Fuel"), r.reply);
  const bp = await store.select("transactions", { eq: { merchant_name: "BP" } });
  assert.ok(bp.length > 0 && bp.every((t) => t.category_id === cat("Transport/Fuel").id));
  ok('rules: "Z Energy or BP is Fuel" resolves to Transport/Fuel');

  r = await say("I paid 40 cash for a haircut yesterday");
  const cash = await store.select("transactions", { eq: { is_manual: true } });
  assert.equal(cash.length, 1);
  assert.equal(cash[0].amount, -40);
  assert.equal(cash[0].local_date, addDays(todayLocal(), -1));
  ok(`cash: -$40 haircut on ${cash[0].local_date} (${r.reply.split("\n")[0]})`);

  r = await say("How much have I spent on Uber Eats in the last 3 months?");
  const range = resolvePeriod("last_3_months");
  const expected = (await findTransactions(store, { merchant: "Uber Eats", ...range })).reduce((a, t) => a - t.amount, 0);
  const call = r.tool_calls.find((c) => c.name === "query_spending")!;
  assert.equal((call.result as { total_spent: number }).total_spent, Math.round(expected * 100) / 100);
  assert.ok(expected > 100);
  ok(`query: Uber Eats last 3 months = $${expected.toFixed(2)} (matches DB)`);

  r = await say("Am I on track this month?");
  const status = await budgetStatus(store);
  assert.ok(r.tool_calls.some((c) => c.name === "get_budget_status"));
  assert.ok(status.categories.some((c) => c.name === "Rent" && c.budget === 1950));
  ok(`budget status: ${r.reply.split("\n")[0]}`);

  // Confirmation gate for bulk changes.
  r = await say("Move all Uber Eats to Other");
  const pending = r.tool_calls[0].result as Record<string, unknown>;
  assert.equal(pending.needs_confirmation, true, "should require confirmation");
  const uberBefore = await store.select("transactions", { eq: { merchant_name: "Uber Eats" } });
  assert.ok(uberBefore.length >= BULK_CONFIRM_THRESHOLD && uberBefore.every((t) => t.category_id === cat("Takeaways").id));
  // A model trying to self-confirm in the same turn is rejected.
  const sneaky = await executeTool(
    { store, priorTokens: new Set() },
    "recategorise_transactions",
    { ...(r.tool_calls[0].input as object), confirmed: true, confirmation_token: pending.confirmation_token },
  );
  assert.equal(sneaky.needs_confirmation, true);
  ok(`bulk recategorise of ${uberBefore.length} txns needs confirmation; same-turn self-confirm rejected`);
  r = await say("yes");
  const uberAfter = await store.select("transactions", { eq: { merchant_name: "Uber Eats" } });
  assert.ok(uberAfter.every((t) => t.category_id === cat("Other").id));
  ok("after user says yes, all Uber Eats moved");

  // Delete category requires confirmation.
  await say("create category Pets");
  assert.ok((await store.select("categories")).some((c) => c.name === "Pets"));
  r = await say("delete the Entertainment category");
  assert.ok((await store.select("categories")).some((c) => c.name === "Entertainment"), "not deleted before confirmation");
  r = await say("yes");
  assert.ok(!(await store.select("categories")).some((c) => c.name === "Entertainment"));
  const orphan = await store.select("transactions", { eq: { id: coffee.id } });
  assert.equal(orphan[0].category_id, null);
  ok("delete_category: preview → confirm → deleted, its transactions back to Uncategorised");

  const sysDel = await executeTool({ store, priorTokens: new Set() }, "delete_category", { category: "Transfers" });
  assert.ok(sysDel.error);
  ok("system categories (Transfers/Salary) are protected");

  // ------------------------------------------------------------ dashboard
  const d = await dashboard(store);
  assert.equal(d.trend.length, 6);
  assert.ok(d.trend.slice(0, 5).every((m) => m.spent > 1000), JSON.stringify(d.trend));
  assert.ok(d.top_merchants.length > 0);
  ok(`dashboard: 6-month trend ${d.trend.map((m) => `${m.label} $${Math.round(m.spent)}`).join(", ")}`);

  // ---------------------------------------------------------- net off
  console.log("Net off (reimbursements)");
  // Ambiguous chat request against mock data: several Snus Direct / Sam rows.
  r = await say("The $100 from Sam was for Snus Direct");
  const amb = r.tool_calls[0].result as { needs_choice?: boolean; expense_candidates: unknown[]; income_candidates: unknown[] };
  assert.equal(amb.needs_choice, true, JSON.stringify(amb).slice(0, 300));
  assert.equal((await store.select("reimbursement_links")).length, 0, "nothing linked while ambiguous");
  assert.match(r.reply, /which one/);
  r = await say("1 1");
  const linkedMock = await store.select("reimbursement_links");
  assert.equal(linkedMock.length, 1);
  assert.equal(linkedMock[0].amount, 100);
  ok(`ambiguous "$100 from Sam" → asks which (${amb.expense_candidates.length} expenses × ${amb.income_candidates.length} payments), links after choice`);

  await netOffTests();

  console.log(`\nAll ${passed} checks passed.`);
}

/** Full, partial, split, unlink and limit cases on a clean store with known amounts. */
async function netOffTests() {
  const store2 = new LocalStore("net-user", path.join(dir, "net.json"));
  await ensureSeeded(store2);
  const cats2 = await store2.select("categories");
  const c = (n: string) => cats2.find((x) => x.name === n)!.id;
  const today = todayLocal();
  const d = (n: number) => addDays(today, -n);
  const mk = (description: string, amount: number, daysAgo: number, category: string | null) => ({
    akahu_id: `test_${description.replace(/\W+/g, "_")}`,
    account_id: null,
    date: `${d(daysAgo)}T01:00:00.000Z`,
    local_date: d(daysAgo),
    description,
    merchant_name: null,
    amount,
    type: amount < 0 ? "CREDIT CARD" : "CREDIT",
    akahu_category: null,
    category_id: category ? c(category) : null,
    category_source: category ? ("manual" as const) : null,
    is_transfer: false,
    is_manual: false,
    notes: null,
  });
  const rows = await store2.insert("transactions", [
    mk("SNUS DIRECT", -365, 10, "Other"),
    mk("SAM WILSON", 100, 8, null),
    mk("PIZZA NIGHT", -60, 6, "Takeaways"),
    mk("TOM BROWN", 60, 5, "Salary"), // categorised as income: linking must remove it from income
    mk("SOUL BAR & BISTRO", -120, 4, "Bars"),
    mk("JACK HARRIS", 60, 3, null),
    mk("CONCERT TICKETS", -80, 4, "Entertainment"),
    mk("MIA CHEN", 150, 2, null),
  ]);
  const id = (desc: string) => rows.find((x) => x.description === desc)!.id;
  const month = async () => {
    const s = await spendingByCategory(store2, d(30), today);
    const spent = (n: string) => s.rows.find((x) => x.name === n)?.spent ?? 0;
    return { spent, income: s.income, total: s.total };
  };
  const before = await month();
  assert.equal(before.spent("Other"), 365);
  assert.equal(before.income, 60);

  // Partial: $365 at Snus Direct minus $100 from Sam = $265.
  const partial = await linkReimbursement(store2, { expense_id: id("SNUS DIRECT"), income_id: id("SAM WILSON") });
  assert.equal(partial.amount, 100);
  assert.equal(partial.expense.net, 265);
  assert.equal((await month()).spent("Other"), 265);
  const [view] = await describeNet(store2, await store2.select("transactions", { eq: { id: id("SNUS DIRECT") } }));
  assert.equal(view.net_amount, -265);
  assert.equal(view.reimbursed_by[0].other_name, "SAM WILSON");
  const [samView] = await describeNet(store2, await store2.select("transactions", { eq: { id: id("SAM WILSON") } }));
  assert.equal(samView.linked_to[0].other_name, "SNUS DIRECT");
  assert.equal(samView.unallocated, 0);
  ok("partial: Snus Direct $365 − $100 from Sam = $265 net in Other; Sam shows 'linked to SNUS DIRECT'");

  // Full: pizza fully paid back by a payment that was categorised as Salary.
  const full = await linkReimbursement(store2, { expense_id: id("PIZZA NIGHT"), income_id: id("TOM BROWN") });
  assert.equal(full.expense.net, 0);
  const afterFull = await month();
  assert.equal(afterFull.spent("Takeaways"), 0);
  assert.equal(afterFull.income, 0, "linked incoming money is excluded from Salary/income");
  ok("full: $60 pizza fully netted → $0 in Takeaways, and Tom's $60 no longer counted as Salary income");

  // Split: one $150 payment across two expenses.
  const s1 = await linkReimbursement(store2, { expense_id: id("SOUL BAR & BISTRO"), income_id: id("MIA CHEN"), amount: 90 });
  assert.equal(s1.income.unallocated, 60);
  const [miaPartial] = await describeNet(store2, await store2.select("transactions", { eq: { id: id("MIA CHEN") } }));
  assert.equal(miaPartial.unallocated, 60);
  const s2 = await linkReimbursement(store2, { expense_id: id("CONCERT TICKETS"), income_id: id("MIA CHEN"), amount: 60 });
  assert.equal(s2.income.unallocated, 0);
  const afterSplit = await month();
  assert.equal(afterSplit.spent("Bars"), 30);
  assert.equal(afterSplit.spent("Entertainment"), 20);
  const [mia] = await describeNet(store2, await store2.select("transactions", { eq: { id: id("MIA CHEN") } }));
  assert.equal(mia.linked_to.length, 2);
  ok("split: Mia's $150 → $90 Soul Bar + $60 concert; Bars $30 net, Entertainment $20 net, $0 unallocated");

  // Limits: never more than the incoming or the expense.
  await assert.rejects(
    linkReimbursement(store2, { expense_id: id("SNUS DIRECT"), income_id: id("MIA CHEN"), amount: 1 }),
    /unallocated|fully allocated/,
  );
  await assert.rejects(
    linkReimbursement(store2, { expense_id: id("CONCERT TICKETS"), income_id: id("JACK HARRIS"), amount: 30 }),
    /left to net off/,
  );
  await assert.rejects(linkReimbursement(store2, { expense_id: id("SAM WILSON"), income_id: id("JACK HARRIS") }), /expense/);
  await assert.rejects(linkReimbursement(store2, { expense_id: id("SNUS DIRECT"), income_id: id("PIZZA NIGHT") }), /incoming/);
  ok("limits: can't exceed the incoming amount or the expense amount; wrong directions rejected");

  // Unlink restores gross.
  const snusLink = (await store2.select("reimbursement_links", { eq: { expense_id: id("SNUS DIRECT") } }))[0];
  assert.ok(await unlinkReimbursement(store2, snusLink.id));
  assert.equal((await month()).spent("Other"), 365);
  const [samAfter] = await describeNet(store2, await store2.select("transactions", { eq: { id: id("SAM WILSON") } }));
  assert.equal(samAfter.linked_to.length, 0);
  ok("unlink: Snus Direct back to $365, Sam's $100 free again");

  // Budgets use net amounts.
  await setBudget(store2, { category: "Bars", amount: 100 });
  const bs = await budgetStatus(store2);
  const bars = bs.categories.find((x) => x.name === "Bars")!;
  assert.equal(bars.spent, 30);
  assert.equal(bars.remaining, 70);
  ok("budget status uses net: Bars $30 of $100");

  // Chat: the user's two phrasings, unique matches on this store.
  const hist: ChatMessage[] = [];
  const say2 = async (text: string) => {
    const res = await runMockPlanner({ store: store2, priorTokens: new Set() }, hist, text);
    hist.push({ id: `u${hist.length}`, user_id: "net-user", role: "user", content: text, tool_calls: null, created_at: "" });
    hist.push({ id: `a${hist.length}`, user_id: "net-user", role: "assistant", content: res.reply, tool_calls: res.tool_calls, created_at: "" });
    return res;
  };
  let res = await say2("The $100 from Sam was for Snus Direct");
  assert.equal((res.tool_calls[0].result as { linked: number }).linked, 100, res.reply);
  assert.match(res.reply, /\$365\.00 → \$265\.00 net/);
  ok(`chat: "${hist[0].content}" → ${res.reply.split("\n")[0]}`);

  // Soul Bar already has $90 linked of $120; make a fresh one for "half of dinner".
  await store2.insert("transactions", [mk("SOUL BAR PONSONBY", -84, 1, "Bars"), mk("JACK HARRIS DINNER", 42, 0, null)]);
  const linksBefore = (await store2.select("reimbursement_links")).length;
  res = await say2("Jack paid me back half of dinner at Soul Bar");
  const half = res.tool_calls[0].result as Record<string, unknown>;
  // Two Soul Bar expenses still have money left: it must ask, not guess.
  assert.equal(half.needs_choice, true, res.reply);
  assert.equal((await store2.select("reimbursement_links")).length, linksBefore, "nothing new linked while ambiguous");
  res = await say2("1"); // most recent Soul Bar ($84)
  const jackLinks = await store2.select("reimbursement_links");
  const dinner = jackLinks.find((l) => l.amount === 42);
  assert.ok(dinner, `expected a $42 link, got ${JSON.stringify(jackLinks.map((l) => l.amount))} — ${res.reply}`);
  ok(`chat: "Jack paid me back half of dinner at Soul Bar" → asked which Soul Bar, then linked $42 of $84`);

  // Tool directly: unknown payer → clear error, nothing linked.
  const none = await executeTool({ store: store2, priorTokens: new Set() }, "link_reimbursement", { expense: "Snus Direct", income_from: "Zelda" });
  assert.ok(none.error);
  ok("link_reimbursement with no matching payment returns an error and links nothing");
}

main()
  .catch((e) => {
    console.error("\n✗ FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(dir, { recursive: true, force: true }));

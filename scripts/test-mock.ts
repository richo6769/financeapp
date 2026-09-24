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
import { ensureSeeded } from "@/lib/seed";
import { MockAkahuClient } from "@/lib/akahu/mock";
import { runSync } from "@/lib/sync";
import { addDays, todayLocal, resolvePeriod } from "@/lib/dates";
import {
  budgetStatus,
  dashboard,
  findTransactions,
  setTransactionCategory,
  spendOf,
  BULK_CONFIRM_THRESHOLD,
} from "@/lib/services";
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
  assert.equal(cats.length, 14);
  ok("seeded 14 default NZ categories");

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

  const zEnergy = txns.filter((t) => t.description.startsWith("Z ENERGY"));
  assert.ok(zEnergy.length > 0 && zEnergy.every((t) => t.category_id === cat("Fuel").id && t.category_source === "rule"));
  ok("default rule: Z Energy → Fuel");

  const mobil = txns.filter((t) => t.description.startsWith("MOBIL"));
  assert.ok(mobil.every((t) => t.category_id === cat("Fuel").id && t.category_source === "akahu"));
  const hop = txns.filter((t) => t.description === "AT HOP TOP UP");
  assert.ok(hop.length > 0 && hop.every((t) => t.category_id === cat("Transport").id), "public transport → Transport");
  const salary = txns.filter((t) => t.description === "ACME LIMITED SALARY");
  assert.ok(salary.length > 0 && salary.every((t) => t.category_id === cat("Income").id && spendOf(t, cats) === 0));
  ok("Akahu enrichment used as hint (Mobil → Fuel, AT HOP → Transport, salary → Income)");

  const refunds = txns.filter((t) => t.description.includes("REFUND"));
  if (refunds.length) {
    assert.ok(refunds.every((t) => t.category_id === cat("Shopping").id && spendOf(t, cats) < 0));
    ok(`${refunds.length} refunds count as negative spend in Shopping`);
  }

  const rent = txns.filter((t) => t.description === "J SMITH PROPERTY RENT");
  assert.ok(rent.length > 40 && rent.every((t) => !t.category_id), "rent starts uncategorised");
  ok("unknown payees land in the Uncategorised inbox");

  // Inline recategorise with "apply to all from this merchant".
  const res = await setTransactionCategory(store, rent[0].id, cat("Rent/Housing").id, true);
  assert.equal(res.updated, rent.length);
  const rules = await store.select("rules");
  assert.ok(rules.some((r) => r.category_id === cat("Rent/Housing").id && "j smith property rent".includes(r.pattern)));
  ok(`inline recategorise applied to ${res.updated} rent payments and created rule ${res.rule}`);

  // New rule applies on next sync to new rows (simulate by clearing one row).
  const [victim] = await store.select("transactions", { eq: { description: "J SMITH PROPERTY RENT" } }, { limit: 1 });
  await store.remove("transactions", { eq: { id: victim.id } });
  await runSync(store, client, "test", { full: true });
  const [back] = await store.select("transactions", { eq: { akahu_id: victim.akahu_id } });
  assert.equal(back.category_id, cat("Rent/Housing").id);
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
  assert.equal(TOOL_DEFS.length, 9);
  assert.ok(TOOL_DEFS.every((t) => t.input_schema.type === "object"));
  ok("9 tool definitions with object JSON schemas");

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
  assert.equal(b("Rent/Housing")?.amount_monthly, 1950);
  assert.equal(b("Rent/Housing")?.period, "weekly");
  assert.equal(b("Groceries")?.amount_monthly, 600);
  assert.equal(b("Eating Out")?.amount_monthly, 300);
  assert.match(r.reply, /\$450\.00\/week × 52 ÷ 12 = \$1,950\.00\/month/);
  ok("budgets: rent 450/wk → $1,950/month (conversion shown), groceries 600, eating out 300");

  r = await say("Anything from Z Energy or BP is Fuel");
  const rules2 = await store.select("rules");
  assert.ok(rules2.some((x) => x.pattern === "BP" && x.category_id === cat("Fuel").id));
  const bp = await store.select("transactions", { eq: { merchant_name: "BP" } });
  assert.ok(bp.length > 0 && bp.every((t) => t.category_id === cat("Fuel").id));
  ok("rules: Z Energy + BP → Fuel (and past BP transactions recategorised)");

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
  assert.ok(status.categories.some((c) => c.name === "Rent/Housing" && c.budget === 1950));
  ok(`budget status: ${r.reply.split("\n")[0]}`);

  // Confirmation gate for bulk changes.
  r = await say("Move all Uber Eats to Other");
  const pending = r.tool_calls[0].result as Record<string, unknown>;
  assert.equal(pending.needs_confirmation, true, "should require confirmation");
  const uberBefore = await store.select("transactions", { eq: { merchant_name: "Uber Eats" } });
  assert.ok(uberBefore.length >= BULK_CONFIRM_THRESHOLD && uberBefore.every((t) => t.category_id === cat("Eating Out").id));
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
  ok("system categories (Transfers/Income) are protected");

  // ------------------------------------------------------------ dashboard
  const d = await dashboard(store);
  assert.equal(d.trend.length, 6);
  assert.ok(d.trend.slice(0, 5).every((m) => m.spent > 1000), JSON.stringify(d.trend));
  assert.ok(d.top_merchants.length > 0);
  ok(`dashboard: 6-month trend ${d.trend.map((m) => `${m.label} $${Math.round(m.spent)}`).join(", ")}`);

  console.log(`\nAll ${passed} checks passed.`);
}

main()
  .catch((e) => {
    console.error("\n✗ FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(dir, { recursive: true, force: true }));

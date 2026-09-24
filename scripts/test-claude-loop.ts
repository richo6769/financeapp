/**
 * Exercises the real Claude tool-use loop (lib/chat/agent.ts) against a local
 * fake Messages API, so the request/response wiring is tested without a key.
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Req = { model: string; system: { text: string }[] | string; tools?: { name: string }[]; messages: { role: string; content: unknown }[]; thinking?: unknown };
const seen: Req[] = [];
const recapRequests: Req[] = [];
let recapReply = "";

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const r = JSON.parse(body) as Req;
    if (!r.tools) {
      // Weekly recap request (no tools): reply with whatever the test queued.
      recapRequests.push(r);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "msg_recap", type: "message", role: "assistant", model: r.model, content: [{ type: "text", text: recapReply }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      return;
    }
    seen.push(r);
    const last = r.messages[r.messages.length - 1];
    const isToolResult = Array.isArray(last.content) && (last.content as { type: string }[])[0]?.type === "tool_result";
    const content = isToolResult
      ? [{ type: "text", text: "Set: Rent $450.00/week × 52 ÷ 12 = $1,950.00/month." }]
      : [
          { type: "text", text: "Setting that now." },
          { type: "tool_use", id: "toolu_1", name: "set_budget", input: { category: "Rent", amount: 450, period: "weekly" } },
          { type: "tool_use", id: "toolu_2", name: "query_spending", input: { merchant: "Uber Eats", period: "last_3_months" } },
        ];
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: `msg_${seen.length}`,
        type: "message",
        role: "assistant",
        model: r.model,
        content,
        stop_reason: isToolResult ? "end_turn" : "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;

  const { LocalStore } = await import("@/lib/store/local");
  const { ensureSeeded } = await import("@/lib/seed");
  const { runSync } = await import("@/lib/sync");
  const { MockAkahuClient } = await import("@/lib/akahu/mock");
  const { runChatTurn } = await import("@/lib/chat/agent");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "financeapp-claude-"));
  const store = new LocalStore("u", path.join(dir, "db.json"));
  await ensureSeeded(store);
  await runSync(store, new MockAkahuClient(), "test");

  const turn = await runChatTurn(store, [], "My rent is 450 a week. Also how much on Uber Eats lately?");
  assert.equal(turn.mode, "claude");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].model, "claude-sonnet-5");
  assert.deepEqual(seen[0].thinking, { type: "adaptive" });
  assert.equal(seen[0].tools!.length, 18);
  assert.match((seen[0].system as { text: string }[])[1].text, /Categories:[\s\S]*Rent \(expense\)/);
  const toolResults = seen[1].messages[seen[1].messages.length - 1].content as { tool_use_id: string; content: string }[];
  assert.equal(toolResults.length, 2, "both parallel tool results in one user message");
  assert.equal(turn.tool_calls.length, 2);
  const budgets = await store.select("budgets");
  assert.equal(budgets[0].amount_monthly, 1950);
  const q = turn.tool_calls[1].result as { total_spent: number };
  assert.ok(q.total_spent > 0);
  assert.match(turn.reply, /1,950/);
  console.log(`  ✓ Claude loop: 2 requests, parallel tool calls executed, budget saved, Uber Eats = $${q.total_spent}`);

  // Weekly recap: Claude writes prose from computed facts; invented numbers are rejected.
  const { generateRecap, computeRecapFacts, lastWeekStart } = await import("@/lib/recap");
  const { formatNZD } = await import("@/lib/money");
  const facts = await computeRecapFacts(store, lastWeekStart());
  recapReply = `You spent ${formatNZD(facts.total_spent)} last week, which is about $4,321 more than your usual.`;
  const bad = await generateRecap(store, { force: true });
  assert.equal(bad.generated_by, "template", "an invented $4,321 must fall back to the template");
  assert.ok(!bad.summary.includes("4,321"));
  recapReply = `You spent ${formatNZD(facts.total_spent)} last week, compared with ${formatNZD(facts.previous_week_spent)} the week before. Keep an eye on your top merchant, ${facts.top_merchants[0]?.name ?? "none"}.`;
  const good = await generateRecap(store, { force: true });
  assert.equal(good.generated_by, "claude");
  assert.equal(good.summary, recapReply);
  assert.ok(JSON.stringify(recapRequests[0].system).includes("Use ONLY the numbers"));
  console.log(`  ✓ recap: Claude's summary kept when every figure comes from the facts; an invented "$4,321" falls back to the template`);
  fs.rmSync(dir, { recursive: true, force: true });
}

main()
  .catch((e) => {
    console.error("✗ FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => server.close());

"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { useApi } from "@/components/useApi";
import { SYNC_EVENT } from "@/components/SyncButton";

type ToolCall = { name: string; input: unknown; result: Record<string, unknown> };
type Msg = { id: string; role: "user" | "assistant"; content: string; tool_calls: ToolCall[] | null; created_at: string };

const EXAMPLES = [
  "My rent is 450 a week, groceries budget 600 a month, eating out 300",
  "Anything from Z Energy or BP is Fuel",
  "I paid 40 cash for a haircut yesterday",
  "How much have I spent on Uber Eats in the last 3 months?",
  "Am I on track this month?",
  "The $100 from Sam was for Snus Direct",
];

/** Minimal, safe formatting: **bold**, whole-line _notes_, line breaks. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i} className={`block min-h-[1em] ${/^_.+_$/.test(line) ? "text-xs italic text-muted" : ""}`}>
          {line
            .replace(/^_(.+)_$/, "$1")
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>,
            )}
        </span>
      ))}
    </>
  );
}

function toolLabel(c: ToolCall) {
  const r = c.result ?? {};
  if (r.error) return `⚠️ ${c.name}: ${r.error}`;
  if (r.needs_confirmation) return `⏸ ${c.name} — waiting for your confirmation`;
  if (r.needs_choice) return `⏸ ${c.name} — which one?`;
  return `✓ ${c.name.replaceAll("_", " ")}`;
}

export default function Chat() {
  const { data, setData } = useApi<Msg[]>("/api/chat");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = data ?? [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setErr(null);
    setInput("");
    const optimistic: Msg = { id: `tmp-${Date.now()}`, role: "user", content: t, tool_calls: null, created_at: new Date().toISOString() };
    setData([...messages, optimistic]);
    try {
      const r = await api<{ user: Msg; assistant: Msg }>("/api/chat", { method: "POST", json: { message: t } });
      setData([...messages, r.user, r.assistant]);
      if (r.assistant.tool_calls?.length) window.dispatchEvent(new Event(SYNC_EVENT));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setData(messages);
      setInput(t);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-11rem)] flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Chat</h1>
        {messages.length > 0 && (
          <button
            className="text-xs text-muted"
            onClick={async () => {
              if (!confirm("Clear chat history?")) return;
              await api("/api/chat", { method: "DELETE" });
              setData([]);
            }}
          >
            Clear history
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3">
        {messages.length === 0 && (
          <div className="card space-y-2">
            <p className="text-sm text-muted">Tell me about your budget or ask about your spending. Try:</p>
            {EXAMPLES.map((e) => (
              <button key={e} className="block w-full rounded-xl bg-surface-2 px-3 py-2 text-left text-sm" onClick={() => send(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-accent text-accent-ink" : "border border-border bg-surface"}`}>
              {m.tool_calls && m.tool_calls.length > 0 && (
                <details className="mb-1 text-xs text-muted">
                  <summary className="cursor-pointer">{m.tool_calls.map(toolLabel).join(" · ")}</summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px]">
                    {JSON.stringify(m.tool_calls.map((c) => ({ tool: c.name, input: c.input })), null, 1)}
                  </pre>
                </details>
              )}
              <Rich text={m.content} />
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-muted">Thinking…</div>
          </div>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
        <div ref={bottom} />
      </div>

      <form
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mt-3 flex gap-2 bg-bg py-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="input max-h-32 min-h-[2.75rem] flex-1 resize-none"
          rows={1}
          placeholder="Ask or tell me something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          aria-label="Message"
        />
        <button className="btn-primary" disabled={sending || !input.trim()}>Send</button>
      </form>
    </div>
  );
}

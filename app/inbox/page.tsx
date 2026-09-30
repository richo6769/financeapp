"use client";

import { useState } from "react";
import { useApi } from "@/components/useApi";
import { api } from "@/lib/client";
import InboxGroup, { type Group, type Guess } from "@/components/InboxGroup";
import type { Account, Cat } from "@/components/types";

/**
 * Quick triage of uncategorised transactions, grouped by merchant. One tap
 * categorises the whole group; "Guess categories" pre-fills a guess per group
 * and "Save all" applies them (nothing is saved without a tap).
 */
export default function Inbox() {
  const inbox = useApi<{ total: number; groups: Group[]; quick: { debit: string[]; credit: string[] } }>("/api/inbox");
  const cats = useApi<{ categories: Cat[] }>("/api/categories");
  const accounts = useApi<Account[]>("/api/accounts");
  const [toast, setToast] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<Record<string, Guess>>({});
  const [guessing, setGuessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ruleFor, setRuleFor] = useState<Record<string, boolean>>({});
  const groups = inbox.data?.groups ?? [];
  const catList = cats.data?.categories ?? [];
  const pending = groups.filter((g) => guesses[g.key]);
  const wantsRule = (g: Group) => ruleFor[g.key] ?? g.count > 1;

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function guess() {
    setGuessing(true);
    try {
      const r = await api<{ source: "claude" | "offline"; guesses: Record<string, Guess> }>("/api/inbox/guess", { method: "POST", json: {} });
      setGuesses(r.guesses);
      const n = Object.keys(r.guesses).length;
      flash(
        n
          ? `${n} guess${n === 1 ? "" : "es"} ready — check them, then Save all.`
          : r.source === "offline"
            ? "No guesses. Add ANTHROPIC_API_KEY for Claude's guesses."
            : "Claude couldn't guess any of these.",
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Guessing failed");
    } finally {
      setGuessing(false);
    }
  }

  async function saveAll() {
    setSaving(true);
    try {
      const r = await api<{ updated: number; rules: string[] }>("/api/inbox", {
        method: "POST",
        json: { picks: pending.map((g) => ({ key: g.key, category_id: guesses[g.key].category_id, create_rule: wantsRule(g) })) },
      });
      setGuesses({});
      flash(`Saved ${pending.length} group${pending.length === 1 ? "" : "s"} (${r.updated} transactions)${r.rules.length ? ` · ${r.rules.length} rules` : ""}`);
      inbox.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Uncategorised</h1>
        <p className="text-sm text-muted">
          {inbox.data
            ? `${inbox.data.total} transaction${inbox.data.total === 1 ? "" : "s"} from ${groups.length} merchant${groups.length === 1 ? "" : "s"}.`
            : "Loading…"}{" "}
          Tap a category to file every transaction in the group; tick “Create rule” so they don’t come back.
        </p>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={guess} disabled={guessing || saving}>
            {guessing ? "Guessing…" : "✨ Guess categories"}
          </button>
          {pending.length > 0 && (
            <>
              <button className="btn-primary" onClick={saveAll} disabled={saving}>
                {saving ? "Saving…" : `Save all ${pending.length}`}
              </button>
              <button className="text-sm text-muted underline" onClick={() => setGuesses({})}>
                Clear guesses
              </button>
            </>
          )}
        </div>
      )}

      {toast && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{toast}</p>}
      {inbox.data && groups.length === 0 && <p className="card text-center text-sm">🎉 Inbox zero — everything is categorised.</p>}
      {groups.length > 0 && (
        <ul className="card divide-y divide-border py-1">
          {groups.map((g) => (
            <InboxGroup
              key={g.key}
              g={g}
              cats={catList}
              quick={inbox.data!.quick[g.direction]}
              accounts={accounts.data ?? []}
              guess={guesses[g.key]}
              onDismissGuess={() =>
                setGuesses((cur) => {
                  const next = { ...cur };
                  delete next[g.key];
                  return next;
                })
              }
              rule={wantsRule(g)}
              onRuleChange={(v) => setRuleFor((cur) => ({ ...cur, [g.key]: v }))}
              onSaved={(msg) => {
                flash(msg);
                inbox.reload();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

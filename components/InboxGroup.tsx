"use client";

import { useState } from "react";
import { api, money, shortDate } from "@/lib/client";
import CategorySelect from "./CategorySelect";
import TxnRow from "./TxnRow";
import type { Account, Cat, Txn } from "./types";

export type Group = {
  key: string;
  label: string;
  direction: "debit" | "credit";
  count: number;
  total: number;
  first_date: string;
  last_date: string;
  account_ids: string[];
  rule: { pattern: string; field: string };
  ids: string[];
};
/** "12 Jul – 2 Aug", or "1 Oct ’25 – 21 Sept ’26" across years. */
function dateRange(from: string, to: string) {
  const yr = (d: string) => (from.slice(0, 4) === to.slice(0, 4) ? "" : ` ’${d.slice(2, 4)}`);
  return `${shortDate(from)}${yr(from)} – ${shortDate(to)}${yr(to)}`;
}

export type Guess = { category_id: string; confidence: "high" | "medium" | "low" };
export type Undo = { txns: unknown[]; rules_created: string[]; rules_changed: unknown[] };

/**
 * One merchant's uncategorised transactions. Tapping a category saves the
 * whole group at once (and, if ticked, creates a rule so they don't come back).
 */
export default function InboxGroup({
  g,
  cats,
  quick,
  accounts,
  guess,
  onDismissGuess,
  rule,
  onRuleChange,
  onSaved,
  onPending,
}: {
  g: Group;
  cats: Cat[];
  quick: string[];
  accounts: Account[];
  guess?: Guess;
  onDismissGuess: () => void;
  rule: boolean;
  onRuleChange: (v: boolean) => void;
  onSaved: (msg: string, undo?: Undo) => void;
  /** Hide the group straight away while saving; `false` brings it back if the save fails. */
  onPending?: (hidden: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Txn[] | null>(null);
  const name = (id: string) => cats.find((c) => c.id === id)?.name ?? "?";
  const acct = g.account_ids.map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean).join(", ");
  const guessIsQuick = guess && quick.includes(guess.category_id);

  async function save(categoryId: string) {
    setBusy(true);
    onPending?.(true);
    try {
      const r = await api<{ updated: number; rules: string[]; undo: Undo }>("/api/inbox", {
        method: "POST",
        json: { picks: [{ key: g.key, category_id: categoryId, create_rule: rule }] },
      });
      onSaved(`${g.label} → ${name(categoryId)} (${r.updated})${r.rules.length ? ` · rule ${r.rules[0]}` : ""}`, r.undo);
    } catch (e) {
      onPending?.(false);
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !items) {
      const r = await api<{ items: Txn[] }>(`/api/transactions?category=uncategorised&limit=1000`);
      setItems(r.items.filter((t) => g.ids.includes(t.id)));
    }
  }

  const chip = (id: string, highlighted = false) => (
    <button
      key={id}
      type="button"
      disabled={busy}
      onClick={() => save(id)}
      className={`${highlighted ? "btn-primary" : "btn"} px-2.5 py-1 text-xs`}
    >
      {highlighted && "✨ "}
      {name(id)}
    </button>
  );

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {g.label}
            {g.count > 1 && <span className="chip ml-2 align-middle text-xs">×{g.count}</span>}
          </div>
          <div className="text-xs text-muted">
            {g.count > 1 && g.first_date !== g.last_date ? dateRange(g.first_date, g.last_date) : shortDate(g.last_date)}
            {acct && ` · ${acct}`}
          </div>
        </div>
        <div className={`shrink-0 text-sm font-semibold tabular-nums ${g.total > 0 ? "text-good" : ""}`}>
          {g.total > 0 ? "+" : ""}
          {money(g.total)}
        </div>
      </div>

      {guess && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Guess:</span>
          {chip(guess.category_id, true)}
          <span className="text-muted">{guess.confidence} confidence</span>
          <button type="button" className="text-muted underline" onClick={onDismissGuess}>
            not this
          </button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {quick.filter((id) => !(guessIsQuick && id === guess!.category_id)).map((id) => chip(id))}
        <CategorySelect
          cats={cats}
          value={null}
          onChange={(id) => id && save(id)}
          className="w-auto max-w-[9rem]"
          placeholder="More…"
          ariaLabel={`More categories for ${g.label}`}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={rule} onChange={(e) => onRuleChange(e.target.checked)} />
          Create rule “{g.rule.pattern}”
        </label>
        <button type="button" className="underline" onClick={toggle} aria-expanded={open}>
          {open ? "Hide" : g.count > 1 ? `Show ${g.count}` : "Details"}
        </button>
      </div>

      {open && (
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border px-2">
          {!items && <li className="py-2 text-xs text-muted">Loading…</li>}
          {items?.map((t) => (
            <TxnRow key={t.id} t={t} cats={cats} accounts={accounts} onChanged={(msg) => onSaved(msg ?? "Updated")} />
          ))}
        </ul>
      )}
    </li>
  );
}

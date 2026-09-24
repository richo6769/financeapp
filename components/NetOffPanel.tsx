"use client";

import { useEffect, useState } from "react";
import { api, money, shortDate } from "@/lib/client";
import type { Txn } from "./types";

type Candidate = {
  id: string;
  local_date: string;
  description: string;
  merchant_name: string | null;
  amount: number;
  allocated: number;
  unallocated: number;
};

/**
 * Search incoming money (most recent first) and link all or part of a payment
 * to this expense. The expense then counts at its net amount.
 */
export default function NetOffPanel({ expense, onLinked, onClose }: { expense: Txn; onLinked: (msg: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const left = Math.abs(expense.net_amount);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (min) p.set("min", min);
    if (max) p.set("max", max);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const ctrl = new AbortController();
    const h = setTimeout(() => {
      fetch(`/api/reimbursements/candidates?${p}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? setItems(d) : setErr(d.error ?? "Failed to load")))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(h);
      ctrl.abort();
    };
  }, [q, min, max, from, to]);

  async function link(c: Candidate) {
    const raw = amounts[c.id];
    const amount = raw ? Number(raw) : Math.min(left, c.unallocated);
    setBusy(c.id);
    setErr(null);
    try {
      const r = await api<{ amount: number; expense: { gross: number; net: number } }>("/api/reimbursements", {
        method: "POST",
        json: { expense_id: expense.id, income_id: c.id, amount },
      });
      onLinked(`Netted off ${money(r.amount)} · now ${money(r.expense.gross)} → ${money(r.expense.net)} net`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-border bg-surface-2 p-2">
      <div className="flex items-center justify-between text-xs">
        <span>
          Net off <b>{expense.merchant_name ?? expense.description}</b> · {money(left)} left to net
        </span>
        <button className="text-muted" onClick={onClose} aria-label="Close net off">✕</button>
      </div>
      <input className="input w-full py-1 text-sm" placeholder="Search incoming by name, e.g. Sam" value={q} onChange={(e) => setQ(e.target.value)} type="search" autoFocus />
      <div className="grid grid-cols-4 gap-1">
        <input className="input py-1 text-xs" inputMode="decimal" placeholder="Min $" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minimum amount" />
        <input className="input py-1 text-xs" inputMode="decimal" placeholder="Max $" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Maximum amount" />
        <input className="input py-1 text-xs" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input py-1 text-xs" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <ul className="max-h-72 divide-y divide-border overflow-auto">
        {items === null && <li className="py-2 text-xs text-muted">Loading…</li>}
        {items?.length === 0 && <li className="py-2 text-xs text-muted">No incoming money matches.</li>}
        {items?.map((c) => {
          const full = c.unallocated <= 0;
          const suggested = Math.min(left, c.unallocated);
          return (
            <li key={c.id} className="flex items-center gap-2 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.merchant_name ?? c.description}</div>
                <div className="text-muted">
                  {shortDate(c.local_date)} · <span className="text-good">+{money(c.amount)}</span>
                  {c.allocated > 0 && <> · {money(c.unallocated)} unallocated</>}
                </div>
              </div>
              {full ? (
                <span className="chip">fully linked</span>
              ) : (
                <>
                  <input
                    className="input w-20 py-1 text-xs"
                    inputMode="decimal"
                    placeholder={suggested.toFixed(2)}
                    value={amounts[c.id] ?? ""}
                    onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                    aria-label={`Amount of ${c.description} to apply`}
                  />
                  <button className="btn-primary px-2 py-1 text-xs" disabled={busy === c.id || left <= 0} onClick={() => link(c)}>
                    Link
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

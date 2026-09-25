"use client";

import { useState } from "react";
import { api, money, shortDate } from "@/lib/client";
import { useApi } from "./useApi";
import { SYNC_EVENT } from "./SyncButton";

type Suggestion = {
  id: string;
  amount: number;
  reason: string;
  score: number;
  income: { id: string; date: string; description: string; amount: number };
  expense: { id: string; date: string; description: string; amount: number };
};

/** Suggested net offs. Nothing is linked unless the user taps Accept. */
export default function Suggestions() {
  const { data, reload } = useApi<Suggestion[]>("/api/suggestions");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!data?.length) return null;

  async function act(id: string, action: "accept" | "dismiss") {
    setBusy(id);
    try {
      await api(`/api/suggestions/${id}`, { method: "POST", json: { action } });
      setMsg(action === "accept" ? "Linked ✓" : "Dismissed — it won't come back");
      window.dispatchEvent(new Event(SYNC_EVENT));
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  return (
    <section id="suggestions" className="space-y-2">
      <h2 className="font-semibold">Suggested net offs <span className="chip ml-1">{data.length}</span></h2>
      <p className="text-xs text-muted">Money that came in which looks like someone paying you back. Nothing is linked until you tap Accept.</p>
      {msg && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{msg}</p>}
      <ul className="card divide-y divide-border py-1">
        {data.map((s) => (
          <li key={s.id} className="py-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate"><span className="text-good">+{money(s.income.amount)}</span> {s.income.description} <span className="text-muted">({shortDate(s.income.date)})</span></div>
                <div className="truncate text-muted">
                  → {money(s.amount)} off <b className="text-ink">{s.expense.description}</b> {money(Math.abs(s.expense.amount))} ({shortDate(s.expense.date)})
                </div>
                <div className="mt-0.5 text-xs text-muted">{s.reason}</div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn-primary px-3 py-1 text-xs" disabled={busy === s.id} onClick={() => act(s.id, "accept")}>Accept</button>
              <button className="btn px-3 py-1 text-xs" disabled={busy === s.id} onClick={() => act(s.id, "dismiss")}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

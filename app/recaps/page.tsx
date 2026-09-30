"use client";

import { useState } from "react";
import { useApi } from "@/components/useApi";
import { api, money, shortDate } from "@/lib/client";

type Facts = {
  total_spent: number;
  previous_week_spent: number;
  over_budget: { name: string; spent: number; limit: number; kind: string }[];
  top_merchants: { name: string; spent: number }[];
  new_subscriptions: { name: string; amount: number; frequency: string }[];
  open_ious: { count: number; total: number };
  trip: { name: string; spent: number; budget: number | null } | null;
};
type Recap = { id: string; week_start: string; summary: string; generated_by: string; data: Facts };

export default function Recaps() {
  const { data, error, reload } = useApi<Recap[]>("/api/recaps");
  const [busy, setBusy] = useState(false);
  if (error) return <p className="card text-danger">{error}</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Weekly recaps</h1>
          <p className="text-sm text-muted">Written every Monday after the morning sync. Figures are calculated by the app; the summary only restates them.</p>
        </div>
        <button
          className="btn shrink-0"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api("/api/recaps", { method: "POST" }).catch((e) => alert(e.message));
            setBusy(false);
            reload();
          }}
        >
          {busy ? "Writing…" : "Refresh last week"}
        </button>
      </div>
      {data?.length === 0 && <p className="card text-sm text-muted">No recaps yet — the first one arrives next Monday, or tap Refresh.</p>}
      {(data ?? []).map((r) => (
        <article key={r.id} className="card space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Week of {shortDate(r.week_start)}</h2>
            <span className="chip">{r.generated_by === "claude" ? "Claude" : "template"}</span>
          </div>
          <p className="text-sm">{r.summary}</p>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">The numbers</summary>
            <ul className="mt-1 space-y-0.5">
              <li>Spent {money(r.data.total_spent)} (week before {money(r.data.previous_week_spent)})</li>
              {r.data.over_budget.map((o) => <li key={o.name + o.kind}>Over: {o.name} {money(o.spent)} of {money(o.limit)} ({o.kind})</li>)}
              {r.data.top_merchants.map((m) => <li key={m.name}>Top: {m.name} {money(m.spent)}</li>)}
              {r.data.new_subscriptions.map((s) => <li key={s.name}>New subscription: {s.name} {money(s.amount)} {s.frequency}</li>)}
              {r.data.open_ious.count > 0 && <li>Owed to you: {money(r.data.open_ious.total)} ({r.data.open_ious.count})</li>}
              {r.data.trip && <li>Trip {r.data.trip.name}: {money(r.data.trip.spent)}{r.data.trip.budget != null && ` of ${money(r.data.trip.budget)}`}</li>}
            </ul>
          </details>
        </article>
      ))}
    </div>
  );
}

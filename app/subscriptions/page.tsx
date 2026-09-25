"use client";

import { useState } from "react";
import { useApi } from "@/components/useApi";
import { api, money, shortDate } from "@/lib/client";

type Sub = {
  key: string;
  name: string;
  frequency: string;
  amount: number;
  monthly_equivalent: number;
  occurrences: number;
  last_date: string;
  next_expected: string;
  price_increase: { from: number; to: number; pct: number } | null;
  is_new: boolean;
  missed: boolean;
  lapsed: boolean;
};
type Data = { monthly_total: number; subscriptions: Sub[]; ignored: Sub[]; alerts: { price_increases: number; new: number; missed: number } };

export default function Subscriptions() {
  const { data, error, reload } = useApi<Data>("/api/subscriptions");
  const [busy, setBusy] = useState<string | null>(null);
  async function setIgnored(key: string, ignored: boolean) {
    setBusy(key);
    await api("/api/subscriptions", { method: "POST", json: { key, ignored } }).catch((e) => alert(e.message));
    setBusy(null);
    reload();
  }
  if (error) return <p className="card text-danger">{error}</p>;
  if (!data) return <div className="card h-40 animate-pulse" />;
  const active = data.subscriptions.filter((s) => !s.lapsed);
  const lapsed = data.subscriptions.filter((s) => s.lapsed);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Subscriptions</h1>
        <p className="text-sm text-muted">
          {active.length} recurring charges ≈ <b className="text-ink">{money(data.monthly_total)}/month</b>. Detected from 3+ charges from the same merchant at a regular interval (2 for yearly), within ±10% in amount.
        </p>
      </div>
      {(data.alerts.price_increases > 0 || data.alerts.missed > 0 || data.alerts.new > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {data.alerts.price_increases > 0 && <span className="rounded-full bg-danger-soft px-2 py-1 text-danger">▲ {data.alerts.price_increases} price increase{data.alerts.price_increases > 1 ? "s" : ""}</span>}
          {data.alerts.new > 0 && <span className="rounded-full bg-accent-soft px-2 py-1">✦ {data.alerts.new} new</span>}
          {data.alerts.missed > 0 && <span className="rounded-full bg-warn/15 px-2 py-1 text-warn">● {data.alerts.missed} expected charge{data.alerts.missed > 1 ? "s" : ""} missing</span>}
        </div>
      )}
      <ul className="card divide-y divide-border py-1">
        {active.map((s) => (
          <li key={s.key} className="py-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name}</div>
                <div className="text-xs text-muted">
                  {money(s.amount)} {s.frequency} · next {shortDate(s.next_expected)} · {money(s.monthly_equivalent)}/mo
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.price_increase && <span className="chip text-danger">▲ {money(s.price_increase.from)} → {money(s.price_increase.to)} (+{s.price_increase.pct}%)</span>}
                  {s.is_new && <span className="chip">✦ new</span>}
                  {s.missed && <span className="chip text-warn">● expected {shortDate(s.next_expected)}, not seen</span>}
                </div>
              </div>
              <button className="shrink-0 text-xs text-muted hover:text-danger" disabled={busy === s.key} onClick={() => setIgnored(s.key, true)}>
                Not a subscription
              </button>
            </div>
          </li>
        ))}
        {active.length === 0 && <li className="py-3 text-sm text-muted">No recurring charges detected yet.</li>}
      </ul>
      {lapsed.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">Looks cancelled ({lapsed.length})</summary>
          <ul className="mt-2 divide-y divide-border text-sm">
            {lapsed.map((s) => (
              <li key={s.key} className="flex justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{s.name}</span>
                <span className="shrink-0 text-muted">last {shortDate(s.last_date)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.ignored.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">Hidden ({data.ignored.length})</summary>
          <ul className="mt-2 divide-y divide-border text-sm">
            {data.ignored.map((s) => (
              <li key={s.key} className="flex justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{s.name}</span>
                <button className="shrink-0 text-xs text-accent" onClick={() => setIgnored(s.key, false)}>Show again</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useApi } from "@/components/useApi";
import { api, money, shortDate } from "@/lib/client";

type Iou = {
  id: string;
  person_name: string;
  amount: number;
  balance: number;
  status: string;
  age_days: number;
  expense: { id: string; date: string; description: string; amount: number } | null;
};
type Data = { total: number; people: { person: string; total: number; oldest_days: number; ious: Iou[] }[]; closed: Iou[] };

export default function Owed() {
  const { data, error, reload } = useApi<Data>("/api/ious");
  const [msg, setMsg] = useState<string | null>(null);
  async function act(id: string, action: "cancel" | "settle", label: string) {
    if (action === "cancel" && !confirm(`Cancel this IOU (${label})?`)) return;
    await api(`/api/ious/${id}`, { method: "PATCH", json: { action } });
    setMsg(action === "cancel" ? "IOU cancelled" : "Marked as paid");
    setTimeout(() => setMsg(null), 3000);
    reload();
  }
  if (error) return <p className="card text-danger">{error}</p>;
  if (!data) return <div className="card h-40 animate-pulse" />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Owed to me</h1>
        <p className="text-sm text-muted">
          {data.people.length ? `${money(data.total)} across ${data.people.length} ${data.people.length === 1 ? "person" : "people"}.` : "Nobody owes you anything."} Add an IOU from any expense (the IOU button), or tell the chat “Sam owes me 100 for Snus Direct”. Net off their payment and it settles automatically.
        </p>
      </div>
      {msg && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{msg}</p>}
      {data.people.map((p) => (
        <section key={p.person} className="card">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">{p.person}</h2>
            <span className="font-semibold">{money(p.total)}</span>
          </div>
          <p className="text-xs text-muted">oldest {p.oldest_days} day{p.oldest_days === 1 ? "" : "s"}</p>
          <ul className="mt-2 divide-y divide-border">
            {p.ious.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{i.expense ? `${i.expense.description} · ${shortDate(i.expense.date)}` : "(expense removed)"}</span>
                  <span className="text-xs text-muted">
                    {i.balance < i.amount ? `${money(i.balance)} left of ${money(i.amount)}` : money(i.amount)} · {i.age_days} day{i.age_days === 1 ? "" : "s"} old
                  </span>
                </span>
                <span className="flex gap-2 text-xs">
                  <button className="text-accent" onClick={() => act(i.id, "settle", i.person_name)}>Paid</button>
                  <button className="text-muted hover:text-danger" onClick={() => act(i.id, "cancel", `${i.person_name} ${money(i.balance)}`)}>Cancel</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data.closed.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">Settled & cancelled ({data.closed.length})</summary>
          <ul className="mt-2 divide-y divide-border text-sm">
            {data.closed.map((i) => (
              <li key={i.id} className="flex justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{i.person_name} · {i.expense?.description ?? "—"}</span>
                <span className="shrink-0 text-muted">{i.status} · {money(i.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

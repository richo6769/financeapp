"use client";

import { use, useState } from "react";
import { useApi } from "@/components/useApi";
import DailyBars from "@/components/DailyBars";
import { api, money, shortDate } from "@/lib/client";

type Summary = {
  trip: { id: string; name: string; start_date: string; end_date: string; budget: number | null; exclude_from_monthly: boolean; include_all: boolean };
  status: string;
  total_days: number;
  days_elapsed: number;
  days_left: number;
  spent: number;
  budget: number | null;
  remaining: number | null;
  daily_average: number;
  remaining_per_day: number | null;
  by_day: { date: string; spent: number }[];
  by_category: { name: string; spent: number }[];
  transactions: { id: string; local_date: string; description: string; amount: number; foreign_amount: number | null; foreign_currency: string | null; category: string; manual: boolean }[];
};
type Found = { items: { id: string; local_date: string; description: string; merchant_name: string | null; amount: number; trip: { id: string } | null }[] };

export default function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useApi<Summary>(`/api/trips/${id}`);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found["items"] | null>(null);

  async function patch(p: Record<string, unknown>) {
    await api(`/api/trips/${id}`, { method: "PATCH", json: p }).catch((e) => alert(e.message));
    reload();
  }
  async function member(transaction_id: string, mode: "include" | "exclude") {
    await api(`/api/trips/${id}/transactions`, { method: "POST", json: { transaction_id, mode } }).catch((e) => alert(e.message));
    setFound(null);
    reload();
  }
  if (error) return <p className="card text-danger">{error}</p>;
  if (!data) return <div className="card h-40 animate-pulse" />;
  const t = data.trip;
  const over = data.remaining != null && data.remaining < 0;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t.name}</h1>
        <p className="text-sm text-muted">
          {shortDate(t.start_date)} – {shortDate(t.end_date)} · {data.total_days} days · {data.status}
          {data.status === "active" && ` · day ${data.days_elapsed}`}
        </p>
      </div>
      <section className="grid grid-cols-2 gap-2">
        <div className="card p-3">
          <div className="text-[11px] text-muted">Spent{data.budget != null ? " of budget" : ""}</div>
          <div className="text-lg font-semibold">{money(data.spent, true)}{data.budget != null && <span className="text-sm font-normal text-muted"> / {money(data.budget, true)}</span>}</div>
          {data.budget != null && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round((data.spent / Math.max(1, data.budget)) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Trip budget used">
              <div className={`h-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(100, Math.max(0, (data.spent / Math.max(1, data.budget)) * 100))}%` }} />
            </div>
          )}
        </div>
        <div className="card p-3">
          <div className="text-[11px] text-muted">Remaining</div>
          <div className={`text-lg font-semibold ${over ? "text-danger" : ""}`}>{data.remaining == null ? "—" : money(data.remaining, true)}</div>
          <div className="text-[11px] text-muted">{data.days_left} day{data.days_left === 1 ? "" : "s"} left</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] text-muted">Daily average so far</div>
          <div className="text-lg font-semibold">{money(data.daily_average, true)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] text-muted">Can spend per day</div>
          <div className={`text-lg font-semibold ${data.remaining_per_day != null && data.remaining_per_day < data.daily_average ? "text-warn" : ""}`}>
            {data.remaining_per_day == null ? "—" : money(data.remaining_per_day, true)}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold">Spend per day</h2>
        <DailyBars data={data.by_day} />
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">By category</h2>
        <ul className="divide-y divide-border text-sm">
          {data.by_category.map((c) => (
            <li key={c.name} className="flex justify-between gap-2 py-2"><span>{c.name}</span><span className="font-medium">{money(c.spent)}</span></li>
          ))}
          {data.by_category.length === 0 && <li className="py-2 text-muted">No trip spending yet.</li>}
        </ul>
      </section>

      <section className="card space-y-2 text-sm">
        <label className="flex items-center justify-between gap-2">
          <span>Keep out of monthly budgets</span>
          <input type="checkbox" checked={t.exclude_from_monthly} onChange={(e) => patch({ exclude_from_monthly: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Include ALL spending in these dates <span className="block text-xs text-muted">Off: only foreign-currency and Travel</span></span>
          <input type="checkbox" checked={t.include_all} onChange={(e) => patch({ include_all: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Budget</span>
          <input className="input w-28 py-1 text-sm" inputMode="decimal" defaultValue={t.budget ?? ""} onBlur={(e) => patch({ budget: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Trip budget" />
        </label>
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Transactions ({data.transactions.length})</h2>
        <form
          className="mb-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await api<Found>(`/api/transactions?q=${encodeURIComponent(q)}&limit=20`);
            setFound(r.items.filter((x) => x.amount < 0));
          }}
        >
          <input className="input min-w-0 flex-1 py-1 text-sm" placeholder="Add a transaction: search…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
          <button className="btn py-1 text-xs">Search</button>
        </form>
        {found && (
          <ul className="mb-3 divide-y divide-border rounded-xl bg-surface-2 px-2 text-xs">
            {found.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{shortDate(f.local_date)} {f.merchant_name ?? f.description} {money(f.amount)}</span>
                {f.trip?.id === id ? <span className="chip">on trip</span> : <button className="btn-primary px-2 py-1 text-xs" onClick={() => member(f.id, "include")}>Add</button>}
              </li>
            ))}
            {found.length === 0 && <li className="py-2 text-muted">No matches.</li>}
          </ul>
        )}
        <ul className="divide-y divide-border text-sm">
          {data.transactions.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate">{x.description}</span>
                <span className="text-xs text-muted">
                  {shortDate(x.local_date)} · {x.category}
                  {x.foreign_currency && x.foreign_amount != null && ` · ${x.foreign_currency} ${x.foreign_amount.toLocaleString("en-NZ")}`}
                  {x.manual && " · added manually"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span>{money(x.amount)}</span>
                <button className="text-xs text-muted hover:text-danger" onClick={() => member(x.id, "exclude")} aria-label={`Remove ${x.description} from trip`}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <button
        className="text-xs text-muted hover:text-danger"
        onClick={async () => {
          if (!confirm(`Delete the trip "${t.name}"? Transactions are kept.`)) return;
          await api(`/api/trips/${id}`, { method: "DELETE" });
          window.location.href = "/trips";
        }}
      >
        Delete trip
      </button>
    </div>
  );
}

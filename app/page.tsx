"use client";

import Link from "next/link";
import { useApi } from "@/components/useApi";
import TrendChart from "@/components/TrendChart";
import BudgetBar from "@/components/BudgetBar";
import { money, shortDate } from "@/lib/client";
import { SYNC_EVENT } from "@/components/SyncButton";
import { api } from "@/lib/client";
import { useState } from "react";

type Dash = {
  status: {
    month_label: string;
    days_left: number;
    day_of_month: number;
    days_in_month: number;
    month_fraction_elapsed: number;
    total_spent: number;
    income: number;
    overall_cap: number | null;
    total_of_category_budgets: number;
    remaining: number | null;
    projected_month_spend: number;
    on_track: boolean | null;
    categories: { category_id: string | null; name: string; color: string | null; spent: number; budget: number | null; over: boolean }[];
  };
  trend: { month: string; label: string; spent: number }[];
  top_merchants: { name: string; spent: number; count: number }[];
  accounts: { id: string; name: string; institution: string; type: string; balance_current: number | null }[];
  pending: { id: string; local_date: string; description: string; amount: number }[];
  last_sync: { started_at: string; status: string; mode: string; error: string | null } | null;
  uncategorised_count: number;
};

export default function Dashboard() {
  const { data, error, loading } = useApi<Dash>("/api/dashboard");
  const [first, setFirst] = useState(false);

  if (error) return <p className="card text-danger">{error}</p>;
  if (!data) return <Skeleton />;

  if (!data.last_sync) {
    return (
      <div className="card text-center">
        <h2 className="text-lg font-semibold">Welcome 👋</h2>
        <p className="mt-1 text-sm text-muted">Pull your accounts and the last 12 months of transactions.</p>
        <button
          className="btn-primary mt-4"
          disabled={first}
          onClick={async () => {
            setFirst(true);
            await api("/api/sync", { method: "POST" }).catch(() => {});
            window.dispatchEvent(new Event(SYNC_EVENT));
            setFirst(false);
          }}
        >
          {first ? "Syncing 12 months…" : "Run first sync"}
        </button>
      </div>
    );
  }

  const s = data.status;
  const limit = s.overall_cap ?? (s.total_of_category_budgets || null);
  return (
    <div className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
      <section className="grid grid-cols-3 gap-2">
        <Stat label={`Spent in ${s.month_label.split(" ")[0]}`} value={money(s.total_spent, true)} />
        <Stat
          label={s.overall_cap != null ? "Left of cap" : "Left in budgets"}
          value={s.remaining == null ? "—" : money(s.remaining, true)}
          tone={s.remaining != null && s.remaining < 0 ? "danger" : undefined}
        />
        <Stat label="Days left" value={String(s.days_left)} sub={`of ${s.days_in_month}`} />
      </section>

      {s.on_track != null && (
        <p className={`rounded-xl px-3 py-2 text-sm ${s.on_track ? "bg-accent-soft" : "bg-danger-soft text-danger"}`}>
          {s.on_track ? "✓ On track" : "▲ Ahead of budget pace"} · projected {money(s.projected_month_spend, true)}
          {limit ? ` vs ${money(limit, true)}` : ""} this month
        </p>
      )}

      {data.uncategorised_count > 0 && (
        <Link href="/inbox" className="card flex items-center justify-between">
          <span className="text-sm">
            <b>{data.uncategorised_count}</b> uncategorised transactions
          </span>
          <span className="text-sm text-accent">Triage →</span>
        </Link>
      )}

      <section className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Budgets this month</h2>
          <Link href="/budgets" className="text-sm text-accent">Edit</Link>
        </div>
        {s.categories.length === 0 && <p className="text-sm text-muted">No spending yet this month.</p>}
        {s.categories.map((c) => (
          <BudgetBar key={c.category_id ?? "uncat"} name={c.name} spent={c.spent} budget={c.budget} color={c.color} paceFraction={s.month_fraction_elapsed} />
        ))}
        {s.categories.every((c) => c.budget == null) && s.categories.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            No budgets yet — set them on <Link className="text-accent" href="/budgets">Budgets</Link> or tell the <Link className="text-accent" href="/chat">chat</Link>.
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="font-semibold">Spending, last 6 months</h2>
        <TrendChart data={data.trend} cap={s.overall_cap} />
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Top merchants this month</h2>
        <ul className="divide-y divide-border">
          {data.top_merchants.map((m) => (
            <li key={m.name} className="flex justify-between py-2 text-sm">
              <span className="truncate pr-2">{m.name} <span className="text-muted">×{m.count}</span></span>
              <span className="font-medium">{money(m.spent)}</span>
            </li>
          ))}
          {data.top_merchants.length === 0 && <li className="text-sm text-muted">Nothing yet.</li>}
        </ul>
      </section>

      {data.pending.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-semibold">Pending <span className="chip ml-1">not yet in totals</span></h2>
          <ul className="divide-y divide-border">
            {data.pending.map((p) => (
              <li key={p.id} className="flex justify-between py-2 text-sm">
                <span className="truncate pr-2"><span className="text-muted">{shortDate(p.local_date)}</span> {p.description}</span>
                <span className={p.amount > 0 ? "text-good" : ""}>{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="mb-2 font-semibold">Accounts</h2>
        <ul className="divide-y divide-border">
          {data.accounts.map((a) => (
            <li key={a.id} className="flex justify-between py-2 text-sm">
              <span className="truncate pr-2">{a.name} <span className="text-muted">· {a.institution}</span></span>
              <span className="font-medium">{a.balance_current == null ? "—" : money(a.balance_current)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Last sync {new Date(data.last_sync.started_at).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" })} ·{" "}
          {data.last_sync.mode} · {data.last_sync.status}
          {data.last_sync.error && <span className="text-danger"> — {data.last_sync.error}</span>}
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card h-28 animate-pulse" />
      ))}
    </div>
  );
}

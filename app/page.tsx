"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/components/useApi";
import TrendChart from "@/components/TrendChart";
import BudgetBar from "@/components/BudgetBar";
import { api, money, shortDate } from "@/lib/client";
import { SYNC_EVENT } from "@/components/SyncButton";

type Cap = { category_id: string; name: string; color: string | null; cap: number; spent: number; remaining: number; pct: number; level: "ok" | "warn" | "over" };
type Dash = {
  status: {
    mode: "month" | "cycle";
    cycle_available: boolean;
    period_label: string;
    days_left: number;
    days_in_month: number;
    month_fraction_elapsed: number;
    total_spent: number;
    trip_excluded: number;
    overall_cap: number | null;
    total_of_category_budgets: number;
    remaining: number | null;
    projected_month_spend: number;
    on_track: boolean | null;
    categories: { category_id: string | null; name: string; color: string | null; spent: number; budget: number | null; over: boolean }[];
  };
  trend: { month: string; label: string; spent: number }[];
  top_merchants: { name: string; spent: number; count: number }[];
  accounts: { id: string; name: string; institution: string; type: string; balance_current: number | null; missing_since: string | null }[];
  pending: { id: string; local_date: string; description: string; amount: number }[];
  last_sync: { started_at: string; status: string; mode: string; error: string | null; warnings: string | null } | null;
  uncategorised_count: number;
  suggestion_count: number;
  weekly: { week_start: string; week_end: string; days_left: number; caps: Cap[]; alerts: Cap[] };
  latest_recap: { week_start: string; summary: string } | null;
  owed_to_me: number;
};

const MODE_KEY = "ledger:period-mode";

export default function Dashboard() {
  const [mode, setMode] = useState<"month" | "cycle">("month");
  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === "cycle") setMode("cycle");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const { data, error, loading } = useApi<Dash>(`/api/dashboard?mode=${mode}`);
  const [first, setFirst] = useState(false);
  const choose = (m: "month" | "cycle") => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

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
  const missing = data.accounts.filter((a) => a.missing_since);
  return (
    <div className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
      {data.last_sync.status === "error" && (
        <Link href="/settings" className="block rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          ⚠ Last sync failed: {data.last_sync.error} <span className="underline">Details</span>
        </Link>
      )}
      {data.weekly.alerts.map((c) => (
        <div key={c.category_id} role="alert" className={`rounded-xl px-3 py-2 text-sm ${c.level === "over" ? "bg-danger-soft text-danger" : "bg-warn/15 text-warn"}`}>
          {c.level === "over" ? "▲ Over" : "● 80%+ of"} your {c.name} weekly cap: {money(c.spent)} of {money(c.cap)} ({c.pct}%)
          {c.level === "warn" && ` — ${money(c.remaining)} left for ${data.weekly.days_left} more day${data.weekly.days_left === 1 ? "" : "s"}`}
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-border bg-surface p-0.5 text-sm" role="tablist" aria-label="Budget period">
          {(["month", "cycle"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={s.mode === m}
              className={`rounded-lg px-3 py-1 ${s.mode === m ? "bg-accent text-accent-ink" : "text-muted"}`}
              onClick={() => choose(m)}
            >
              {m === "month" ? "Month" : "Pay cycle"}
            </button>
          ))}
        </div>
        <span className="truncate text-xs text-muted">{s.period_label}</span>
      </div>
      {mode === "cycle" && !s.cycle_available && (
        <p className="text-xs text-muted">
          Set your pay frequency in <Link className="text-accent" href="/settings">Settings</Link> to see pay-cycle budgets (showing the month for now).
        </p>
      )}

      <section className="grid grid-cols-3 gap-2">
        <Stat label="Spent" value={money(s.total_spent, true)} />
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
          {limit ? ` vs ${money(limit, true)}` : ""}
        </p>
      )}
      {s.trip_excluded > 0 && <p className="text-xs text-muted">{money(s.trip_excluded)} of trip spending is kept separate (see Trips).</p>}

      <div className="grid grid-cols-2 gap-2">
        {data.suggestion_count > 0 && (
          <Link href="/inbox#suggestions" className="card flex flex-col p-3">
            <span className="text-lg font-semibold">{data.suggestion_count}</span>
            <span className="text-xs text-muted">suggested net off{data.suggestion_count === 1 ? "" : "s"} →</span>
          </Link>
        )}
        {data.uncategorised_count > 0 && (
          <Link href="/inbox" className="card flex flex-col p-3">
            <span className="text-lg font-semibold">{data.uncategorised_count}</span>
            <span className="text-xs text-muted">uncategorised →</span>
          </Link>
        )}
        {data.owed_to_me > 0 && (
          <Link href="/owed" className="card flex flex-col p-3">
            <span className="text-lg font-semibold">{money(data.owed_to_me, true)}</span>
            <span className="text-xs text-muted">owed to you →</span>
          </Link>
        )}
      </div>

      {data.latest_recap && (
        <Link href="/recaps" className="card block">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Last week</h2>
            <span className="text-xs text-muted">from {shortDate(data.latest_recap.week_start)} · all recaps →</span>
          </div>
          <p className="text-sm">{data.latest_recap.summary}</p>
        </Link>
      )}

      <section className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Budgets</h2>
          <Link href="/budgets" className="text-sm text-accent">Edit</Link>
        </div>
        {s.categories.length === 0 && <p className="text-sm text-muted">No spending yet this period.</p>}
        {s.categories.map((c) => (
          <BudgetBar key={c.category_id ?? "uncat"} name={c.name} spent={c.spent} budget={c.budget} color={c.color} paceFraction={s.month_fraction_elapsed} />
        ))}
        {s.categories.every((c) => c.budget == null) && s.categories.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            No budgets yet — set them on <Link className="text-accent" href="/budgets">Budgets</Link> or tell the <Link className="text-accent" href="/chat">chat</Link>.
          </p>
        )}
      </section>

      {data.weekly.caps.length > 0 && (
        <section className="card">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">This week</h2>
            <span className="text-xs text-muted">
              {shortDate(data.weekly.week_start)} – {shortDate(data.weekly.week_end)} · {data.weekly.days_left} day{data.weekly.days_left === 1 ? "" : "s"} left
            </span>
          </div>
          {data.weekly.caps.map((c) => (
            <BudgetBar key={c.category_id} name={c.name} spent={c.spent} budget={c.cap} color={c.color} paceFraction={(7 - data.weekly.days_left) / 7} />
          ))}
        </section>
      )}

      <section className="card">
        <h2 className="font-semibold">Spending, last 6 months</h2>
        <TrendChart data={data.trend} cap={s.mode === "month" ? s.overall_cap : null} />
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Top merchants</h2>
        <ul className="divide-y divide-border">
          {data.top_merchants.map((m) => (
            <li key={m.name} className="flex justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">{m.name} <span className="text-muted">×{m.count}</span></span>
              <span className="shrink-0 font-medium">{money(m.spent)}</span>
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
              <li key={p.id} className="flex justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate"><span className="text-muted">{shortDate(p.local_date)}</span> {p.description}</span>
                <span className={`shrink-0 ${p.amount > 0 ? "text-good" : ""}`}>{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="mb-2 font-semibold">Accounts</h2>
        <ul className="divide-y divide-border">
          {data.accounts.map((a) => (
            <li key={a.id} className="flex justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {a.name} <span className="text-muted">· {a.institution}</span>
                {a.missing_since && <span className="chip ml-1">not returned by Akahu</span>}
              </span>
              <span className="shrink-0 font-medium">{a.balance_current == null ? "—" : money(a.balance_current)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Last sync {new Date(data.last_sync.started_at).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" })} ·{" "}
          {data.last_sync.mode} · {data.last_sync.status} · <Link href="/settings" className="text-accent">details</Link>
        </p>
        {missing.length > 0 && <p className="mt-1 text-xs text-muted">Missing accounts keep their history; reconnect them at my.akahu.nz if that wasn&apos;t intended.</p>}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
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

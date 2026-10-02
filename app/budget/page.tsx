"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/components/useApi";
import { ForecastDonut, PaceChart } from "@/components/BudgetCharts";
import { CatDot } from "@/components/Avatar";
import { categoryIcon } from "@/lib/catIcons";
import { money, shortDate } from "@/lib/client";

type CatRow = {
  category_id: string | null;
  name: string;
  color: string | null;
  spent: number;
  budget: number | null;
  remaining: number | null;
  over: boolean;
  status: "no budget" | "over budget" | "ahead of pace" | "on track";
  expected_by_now: number | null;
};
type Overview = {
  status: {
    mode: "month" | "cycle";
    cycle_available: boolean;
    period_label: string;
    from: string;
    to: string;
    period_end: string;
    is_current: boolean;
    prev_at: string;
    next_at: string | null;
    days_in_month: number;
    month_fraction_elapsed: number;
    total_spent: number;
    income: number;
    saved: number;
    overall_cap: number | null;
    trip_excluded: number;
    daily: { date: string; spent: number }[];
    categories: CatRow[];
  };
  limit: number | null;
  upcoming: { name: string; amount: number; date: string }[];
  upcoming_total: number;
  safe_to_spend: number | null;
  spent: number;
  measures: "all spending" | "budgeted categories";
  forecast: number;
  next_payday: string | null;
  days_to_payday: number | null;
  period_days_left: number;
};

const MODE_KEY = "ledger:period-mode";

/** "1–31 Oct", "28 Sep – 11 Oct". */
function rangeLabel(from: string, to: string) {
  const f = shortDate(from);
  const t = shortDate(to);
  return from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8))}–${t}` : `${f} – ${t}`;
}

export default function BudgetPage() {
  const [mode, setMode] = useState<"month" | "cycle">("month");
  const [at, setAt] = useState<string | null>(null);
  const [view, setView] = useState<"summary" | "pace">("summary");
  const [showUpcoming, setShowUpcoming] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === "cycle") setMode("cycle");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const choose = (m: "month" | "cycle") => {
    setMode(m);
    setAt(null);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };
  const { data, error } = useApi<Overview>(`/api/budget?mode=${mode}${at ? `&at=${at}` : ""}`);

  if (error) return <p className="card text-danger">{error}</p>;
  if (!data) return <div className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="card h-40 animate-pulse" />)}</div>;
  const s = data.status;
  const fullRange = rangeLabel(s.from, s.period_end);
  const budgeted = s.categories.filter((c) => c.budget != null);
  const unbudgeted = s.categories.filter((c) => c.budget == null && c.spent !== 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="icon-btn" onClick={() => setAt(s.prev_at)} aria-label="Previous period">‹</button>
        <div className="flex flex-col items-center">
          <span className="rounded-full border border-border bg-surface-2 px-4 py-1.5 font-semibold">{fullRange}</span>
          <span className="mt-1 text-[11px] text-muted">{s.mode === "cycle" ? "Pay cycle" : "Month"}{s.is_current ? "" : " · past"}</span>
        </div>
        <button className="icon-btn" onClick={() => s.next_at && setAt(s.next_at)} disabled={!s.next_at} aria-label="Next period">›</button>
      </div>

      <section className="card space-y-4">
        <div className="seg" role="tablist" aria-label="Budget view">
          <button role="tab" aria-selected={view === "summary"} onClick={() => setView("summary")}>◔ Summary</button>
          <button role="tab" aria-selected={view === "pace"} onClick={() => setView("pace")}>↗ Pace</button>
        </div>

        <div className="flex justify-between text-sm">
          <div>
            <div className="text-muted">Next payday</div>
            <div className="text-xl font-semibold">
              {data.days_to_payday != null ? `${data.days_to_payday} day${data.days_to_payday === 1 ? "" : "s"}` : <Link href="/settings" className="text-base text-accent">Set pay cycle</Link>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-muted">{s.is_current ? "Period ends" : "Period"}</div>
            <div className="text-xl font-semibold">{s.is_current ? `${data.period_days_left} day${data.period_days_left === 1 ? "" : "s"}` : "Finished"}</div>
          </div>
        </div>

        {view === "summary" ? (
          <ForecastDonut spent={data.spent} forecast={data.forecast} limit={data.limit} current={s.is_current} />
        ) : (
          <PaceChart daily={s.daily} daysInPeriod={s.days_in_month} limit={data.limit} forecast={data.forecast} current={s.is_current} />
        )}
        {data.limit != null && data.measures === "budgeted categories" && (
          <p className="-mt-2 text-center text-xs text-muted">
            Budgeted categories only ({money(data.spent, true)} of {money(s.total_spent, true)} total spending). Set an overall cap in Edit budgets to track everything.
          </p>
        )}

        <dl className="divide-y divide-border text-sm">
          {data.safe_to_spend != null && (
            <Row icon="👛" label="Safe to spend" hint="limit − spent − bills still due">
              <span className={`text-lg font-semibold ${data.safe_to_spend < 0 ? "text-danger" : ""}`}>{money(data.safe_to_spend)}</span>
            </Row>
          )}
          <Row icon="💵" label="Income" hint={s.is_current ? "so far this period" : undefined}>
            <span className="text-lg font-semibold text-good">{money(s.income, true)}</span>
          </Row>
          <Row icon="🎯" label="Budget limit" badge={data.limit == null ? undefined : s.overall_cap != null ? "cap" : "auto"} hint={data.limit != null && s.overall_cap == null ? "sum of category budgets" : undefined}>
            {data.limit != null ? <span className="text-lg font-semibold">{money(data.limit, true)}</span> : <Link href="/budgets" className="text-accent">Set budgets</Link>}
          </Row>
          {s.is_current && (
            <div className="py-3">
              <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setShowUpcoming((v) => !v)} aria-expanded={showUpcoming}>
                <span className="flex items-center gap-3">
                  <span aria-hidden>🗓️</span>
                  <span>Bills still to come <span className="text-muted">({data.upcoming.length})</span></span>
                </span>
                <span className="font-semibold">{money(data.upcoming_total, true)} <span className="text-muted">{showUpcoming ? "⌃" : "›"}</span></span>
              </button>
              {showUpcoming && (
                <ul className="mt-2 space-y-1 pl-8 text-xs text-muted">
                  {data.upcoming.map((u) => (
                    <li key={u.name + u.date} className="flex justify-between gap-2">
                      <span className="truncate">{u.name} · {shortDate(u.date)}</span>
                      <span>{money(u.amount)}</span>
                    </li>
                  ))}
                  {data.upcoming.length === 0 && <li>Nothing else expected this period.</li>}
                </ul>
              )}
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href="/insights" className="btn flex-1">Categories →</Link>
          <Link href="/budgets" className="btn flex-1">Edit budgets</Link>
        </div>
        {s.mode === "cycle" || s.cycle_available ? (
          <div className="seg" role="tablist" aria-label="Budget period">
            <button role="tab" aria-selected={s.mode === "month"} onClick={() => choose("month")}>Month</button>
            <button role="tab" aria-selected={s.mode === "cycle"} onClick={() => choose("cycle")}>Pay cycle</button>
          </div>
        ) : null}
      </section>

      {budgeted.map((c) => (
        <CategoryCard key={c.category_id ?? "u"} c={c} pace={s.month_fraction_elapsed} from={s.from} to={s.to} label={s.period_label} current={s.is_current} />
      ))}
      {budgeted.length === 0 && (
        <p className="card text-sm text-muted">
          No category budgets yet. <Link href="/budgets" className="text-accent">Set some</Link> to see pace and what&apos;s safe to spend.
        </p>
      )}
      {unbudgeted.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 font-semibold">Other spending</h2>
          <ul className="card divide-y divide-border py-1">
            {unbudgeted.map((c) => (
              <li key={c.category_id ?? "u"}>
                <Link
                  href={`/spending?${new URLSearchParams({ category: c.category_id ?? "uncategorised", from: s.from, to: s.to, period: s.period_label })}`}
                  className="flex items-center gap-3 py-2.5"
                >
                  <CatDot icon={categoryIcon(c.name)} color={c.color} size={32} />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="font-semibold">{money(c.spent)}</span>
                  <span className="text-muted" aria-hidden>›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.trip_excluded > 0 && <p className="px-1 text-xs text-muted">{money(s.trip_excluded)} of trip spending is kept separate (see Trips).</p>}
    </div>
  );
}

function Row({ icon, label, hint, badge, children }: { icon: string; label: string; hint?: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <dt className="flex items-center gap-3">
        <span aria-hidden>{icon}</span>
        <span>
          <span className="flex items-center gap-2">
            {label}
            {badge && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{badge}</span>}
          </span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function CategoryCard({ c, pace, from, to, label, current }: { c: CatRow; pace: number; from: string; to: string; label: string; current: boolean }) {
  const pct = c.budget ? Math.max(0, Math.min(100, (c.spent / c.budget) * 100)) : 0;
  const over = c.over;
  const ahead = c.status === "ahead of pace";
  const href = `/spending?${new URLSearchParams({ category: c.category_id ?? "uncategorised", from, to, period: label })}`;
  return (
    <Link href={href} className="card block active:scale-[0.99]">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl"
          style={{ background: `color-mix(in srgb, ${c.color ?? "#9ca3af"} 45%, transparent)` }}
        >
          {categoryIcon(c.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{c.name}</div>
          <div className={over ? "text-danger" : "text-muted"}>
            {money(c.spent)} <span className="text-muted">of {money(c.budget!, true)}</span>
          </div>
        </div>
        <span className="text-muted" aria-hidden>›</span>
      </div>
      <div className="mt-3">
        {current && <div className="mb-1 text-[11px] text-muted" style={{ paddingLeft: `calc(${pace * 100}% - 12px)` }}>Pace</div>}
        <div
          className="relative h-2.5 overflow-visible rounded-full bg-track"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${c.name}: ${Math.round(pct)}% of budget used`}
        >
          <div className={`h-full rounded-full ${over ? "bg-danger" : ""}`} style={{ width: `${pct}%`, background: over ? undefined : "var(--chart-spent)" }} />
          {current && <div className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink/70" style={{ left: `${pace * 100}%` }} aria-hidden />}
        </div>
        <div className={`mt-2 text-right text-sm font-medium ${over ? "text-danger" : ahead ? "text-warn" : "text-good"}`}>
          {over ? `▲ ${money(c.spent - c.budget!)} over` : ahead ? "● Ahead of pace" : `✓ On track · ${money(c.remaining ?? 0, true)} left`}
        </div>
      </div>
    </Link>
  );
}

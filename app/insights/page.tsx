"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/components/useApi";
import { CatDot } from "@/components/Avatar";
import { categoryIcon } from "@/lib/catIcons";
import { money } from "@/lib/client";

type Row = { category_id: string | null; name: string; color: string; group: string; current: number; previous: number };
type Data = { kind: "spending" | "income"; from: string; to: string; prev_from: string; prev_to: string; total: number; previous_total: number; rows: Row[] };
type Preset = "1M" | "3M" | "1Y" | "All" | "Custom";

function nzToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}
function minusDays(ld: string, n: number) {
  const [y, m, d] = ld.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}
const PRESET_DAYS: Record<Exclude<Preset, "All" | "Custom">, number> = { "1M": 30, "3M": 91, "1Y": 365 };
const PRESET_LABEL: Record<Preset, string> = { "1M": "last 30 days", "3M": "last 3 months", "1Y": "last 12 months", All: "everything", Custom: "this range" };

/** Where money came from and went, compared with the previous period of the same length. */
export default function Insights() {
  const today = nzToday();
  const [kind, setKind] = useState<"spending" | "income">("spending");
  const [preset, setPreset] = useState<Preset>("3M");
  const [custom, setCustom] = useState({ from: minusDays(today, 30), to: today });
  const [grouped, setGrouped] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const { from, to } =
    preset === "Custom" ? custom : preset === "All" ? { from: minusDays(today, 3649), to: today } : { from: minusDays(today, PRESET_DAYS[preset] - 1), to: today };
  const { data, error } = useApi<Data>(`/api/insights?kind=${kind}&from=${from}&to=${to}`);

  const groups = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { name: string; current: number; previous: number; rows: Row[] }>();
    for (const r of data.rows) {
      const k = grouped ? r.group : r.name;
      const g = m.get(k) ?? { name: k, current: 0, previous: 0, rows: [] };
      g.current = Math.round((g.current + r.current) * 100) / 100;
      g.previous = Math.round((g.previous + r.previous) * 100) / 100;
      g.rows.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.current - a.current || b.previous - a.previous);
  }, [data, grouped]);
  const max = Math.max(1, ...groups.map((g) => Math.max(g.current, g.previous)));
  const visible = showAll ? groups : groups.slice(0, 5);
  const isSpend = kind === "spending";
  const change = data ? data.total - data.previous_total : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/budget" className="icon-btn" aria-label="Back to Budget">←</Link>
        <div>
          <h1 className="text-xl font-semibold">Categories</h1>
          <p className="text-sm text-muted">See where money came from and where it went.</p>
        </div>
      </div>

      <section className="card space-y-4">
        <div className="seg" role="tablist" aria-label="Spending or income">
          <button role="tab" aria-selected={isSpend} onClick={() => setKind("spending")}>↑ Spending</button>
          <button role="tab" aria-selected={!isSpend} onClick={() => setKind("income")}>↓ Income</button>
        </div>

        <div>
          <div className="mb-2 text-sm text-muted">Period</div>
          <div className="flex flex-wrap gap-2">
            {(["1M", "3M", "1Y", "All", "Custom"] as Preset[]).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                aria-pressed={preset === p}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${preset === p ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}
              >
                {p === "Custom" ? "📅 Custom" : p}
              </button>
            ))}
          </div>
          {preset === "Custom" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">From<input type="date" className="input mt-1 w-full py-1 text-sm" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
              <label className="text-xs text-muted">To<input type="date" className="input mt-1 w-full py-1 text-sm" value={custom.to} min={custom.from} max={today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}
        {data && (
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-sm text-muted">Total {isSpend ? "spent" : "received"}, {PRESET_LABEL[preset]}</div>
                <div className="text-3xl font-bold">{money(data.total)}</div>
              </div>
              {preset !== "All" && data.previous_total !== 0 && (
                <div className={`text-right text-sm font-medium ${change === 0 ? "text-muted" : (change > 0) === isSpend ? "text-danger" : "text-good"}`}>
                  {change > 0 ? "▲" : change < 0 ? "▼" : "="} {money(Math.abs(change), true)}
                  <div className="text-xs font-normal text-muted">vs previous {money(data.previous_total, true)}</div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{preset === "All" ? "By category" : "Compared with the previous period"}</div>
              <div className="seg w-auto text-xs" role="tablist" aria-label="Group categories">
                <button role="tab" aria-selected={grouped} onClick={() => setGrouped(true)}>Groups</button>
                <button role="tab" aria-selected={!grouped} onClick={() => setGrouped(false)}>All</button>
              </div>
            </div>
            {preset !== "All" && (
              <div className="flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: isSpend ? "var(--danger)" : "var(--good)" }} /> This period</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ink/70" /> Previous</span>
              </div>
            )}

            <ul className="space-y-4">
              {visible.map((g) => {
                const single = g.rows.length === 1 ? g.rows[0] : null;
                const href = single
                  ? `/spending?${new URLSearchParams({ category: single.category_id ?? "uncategorised", from: data.from, to: data.to, period: PRESET_LABEL[preset] })}`
                  : null;
                const body = (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 font-medium">
                        <CatDot icon={categoryIcon(single?.name ?? g.name)} color={single?.color ?? g.rows[0].color} />
                        <span className="truncate">{g.name}</span>
                        {!single && <span className="text-xs text-muted">{g.rows.length} categories {open === g.name ? "⌃" : "›"}</span>}
                      </span>
                      <span className={`shrink-0 font-semibold ${isSpend ? "text-danger" : "text-good"}`}>{money(g.current)}</span>
                    </div>
                    <Bar current={g.current} previous={preset === "All" ? null : g.previous} max={max} spend={isSpend} />
                    {preset !== "All" && <div className="mt-1 text-right text-sm text-muted">Previous {money(g.previous)}</div>}
                  </>
                );
                return (
                  <li key={g.name}>
                    {href ? (
                      <Link href={href} className="block">{body}</Link>
                    ) : (
                      <button className="block w-full text-left" onClick={() => setOpen(open === g.name ? null : g.name)} aria-expanded={open === g.name}>
                        {body}
                      </button>
                    )}
                    {!single && open === g.name && (
                      <ul className="mt-2 space-y-1 rounded-2xl bg-surface-2 p-3 text-sm">
                        {g.rows.map((r) => (
                          <li key={r.name}>
                            <Link
                              href={`/spending?${new URLSearchParams({ category: r.category_id ?? "uncategorised", from: data.from, to: data.to, period: PRESET_LABEL[preset] })}`}
                              className="flex items-center justify-between gap-2 py-1"
                            >
                              <span className="flex min-w-0 items-center gap-2"><CatDot icon={categoryIcon(r.name)} color={r.color} size={20} /> <span className="truncate">{r.name}</span></span>
                              <span className="shrink-0">{money(r.current)} <span className="text-xs text-muted">vs {money(r.previous, true)}</span> ›</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {groups.length > 5 && (
              <button className="w-full text-center text-sm font-medium text-accent" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "⌃ Show fewer" : `⌄ View all ${groups.length} ${grouped ? "groups" : "categories"}`}
              </button>
            )}
            {groups.length === 0 && <p className="text-sm text-muted">Nothing in this period.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function Bar({ current, previous, max, spend }: { current: number; previous: number | null; max: number; spend: boolean }) {
  const w = Math.max(0, Math.min(100, (current / max) * 100));
  const p = previous == null ? null : Math.max(0, Math.min(100, (previous / max) * 100));
  return (
    <div className="relative mt-2 h-2 rounded-full bg-track">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: spend ? "var(--danger)" : "var(--good)" }} />
      {p != null && <div className="absolute -top-1 h-4 w-0.5 rounded bg-ink/70" style={{ left: `calc(${p}% - 1px)` }} aria-hidden />}
    </div>
  );
}

"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/components/useApi";
import TxnRow from "@/components/TxnRow";
import AddCash from "@/components/AddCash";
import SubscriptionsList from "@/components/SubscriptionsList";
import Avatar, { CatDot } from "@/components/Avatar";
import { money } from "@/lib/client";
import type { Account, Cat, Txn } from "@/components/types";

type Tab = "all" | "calendar" | "recurring";
type Pending = { id: string; local_date: string; description: string; amount: number; account_id: string };

export default function ActivityPage() {
  return (
    <Suspense fallback={<div className="card h-40 animate-pulse" />}>
      <Activity />
    </Suspense>
  );
}

function Activity() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>("all");
  const cats = useApi<{ categories: Cat[] }>("/api/categories");
  const accounts = useApi<Account[]>("/api/accounts");
  const catList = cats.data?.categories ?? [];

  return (
    <div className="space-y-4">
      <div className="seg" role="tablist" aria-label="Activity view">
        {(
          [
            ["all", "☰ All"],
            ["calendar", "📅 Calendar"],
            ["recurring", "🔁 Recurring"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "all" && <AllActivity cats={catList} accounts={accounts.data ?? []} focusSearch={sp.get("search") === "1"} />}
      {tab === "calendar" && <CalendarView cats={catList} accounts={accounts.data ?? []} />}
      {tab === "recurring" && <SubscriptionsList embedded />}
    </div>
  );
}

/** Day header label, e.g. "Tue, 29 Sep 2026". */
function dayLabel(ld: string) {
  const [y, m, d] = ld.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A day's net: money in minus money out, leaving transfers/savings and bank-removed rows out. */
function dayNet(rows: Txn[]) {
  return rows.reduce((a, t) => (t.is_transfer || t.removed_at ? a : a + Math.round(t.net_amount * 100)), 0) / 100;
}

function AllActivity({ cats, accounts, focusSearch }: { cats: Cat[]; accounts: Account[]; focusSearch: boolean }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(focusSearch);
  const [toast, setToast] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSearch) search.current?.focus();
  }, [focusSearch]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (account) p.set("account", account);
    if (category) p.set("category", category);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", "300");
    return p.toString();
  }, [query, account, category, from, to]);
  const txns = useApi<{ total: number; items: Txn[] }>(`/api/transactions?${qs}`);
  const pending = useApi<Pending[]>("/api/pending");
  const items = txns.data?.items ?? [];
  const filtered = Boolean(query || account || category || from || to);

  const days = useMemo(() => {
    const m = new Map<string, Txn[]>();
    for (const t of items) {
      if (!m.has(t.local_date)) m.set(t.local_date, []);
      m.get(t.local_date)!.push(t);
    }
    return [...m.entries()];
  }, [items]);
  const totals = useMemo(() => {
    let inC = 0;
    let outC = 0;
    for (const t of items) {
      if (t.is_transfer || t.removed_at) continue;
      const c = Math.round(t.net_amount * 100);
      if (c > 0) inC += c;
      else outC -= c;
    }
    return { in: inC / 100, out: outC / 100 };
  }, [items]);
  const catName = cats.find((c) => c.id === category)?.name ?? (category === "uncategorised" ? "Uncategorised" : "All categories");
  const acctName = accounts.find((a) => a.id === account)?.name ?? "All accounts";

  const changed = (msg?: string) => {
    if (msg) {
      setToast(msg);
      setTimeout(() => setToast(null), 4000);
    }
    txns.reload();
  };

  return (
    <>
      <section className="card p-0">
        <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="text-muted" aria-hidden>⚙︎</span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Filters &amp; summary{filtered ? " •" : ""}</span>
            <span className="block truncate text-sm text-muted">
              {catName} · {acctName} · {txns.data ? `${txns.data.total} transactions` : "…"}
            </span>
          </span>
          <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
            ⌄
          </span>
        </button>
        {open && (
          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            <input
              ref={search}
              className="input col-span-2"
              placeholder="Search merchant or description"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
              aria-label="Search"
            />
            <select className="input py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              <option value="uncategorised">Uncategorised</option>
              {cats.filter((c) => !c.parent_id).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select className="input py-1.5 text-sm" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <label className="text-xs text-muted">From<input type="date" className="input mt-1 w-full py-1 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-xs text-muted">To<input type="date" className="input mt-1 w-full py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <div className="col-span-2 grid grid-cols-2 gap-2 pt-1 text-sm">
              <div className="rounded-2xl bg-surface-2 p-3">
                <div className="text-xs text-muted">Money in</div>
                <div className="font-semibold text-good">+{money(totals.in)}</div>
              </div>
              <div className="rounded-2xl bg-surface-2 p-3">
                <div className="text-xs text-muted">Money out</div>
                <div className="font-semibold text-danger">−{money(totals.out)}</div>
              </div>
            </div>
            <p className="col-span-2 text-xs text-muted">Transfers between your accounts and savings are left out of these totals.</p>
            {filtered && (
              <button className="btn col-span-2" onClick={() => { setQ(""); setAccount(""); setCategory(""); setFrom(""); setTo(""); }}>
                Clear filters
              </button>
            )}
            <div className="col-span-2">
              <AddCash cats={cats} onAdded={() => txns.reload()} />
            </div>
          </div>
        )}
      </section>

      {toast && <p className="sticky top-2 z-10 rounded-2xl bg-accent-soft px-3 py-2 text-sm" role="status">{toast}</p>}
      {txns.error && <p className="card text-danger">{txns.error}</p>}
      {!txns.data && !txns.error && <div className="card h-40 animate-pulse" />}

      {!filtered && (pending.data?.length ?? 0) > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="font-semibold">Pending</h2>
            <span className="text-xs text-muted">not in totals yet</span>
          </div>
          <ul className="card divide-y divide-border py-1">
            {pending.data!.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <Avatar name={p.description} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{p.description}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-sm text-[#8b9cf7]">
                    <CatDot icon="⏳" color="#6366f1" /> Pending
                  </div>
                </div>
                <div className={`shrink-0 text-[15px] font-semibold ${p.amount > 0 ? "text-good" : "text-danger"}`}>
                  {p.amount > 0 ? "+" : ""}
                  {money(p.amount)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {days.map(([day, rows]) => {
        const net = dayNet(rows);
        return (
          <section key={day}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="font-semibold">{dayLabel(day)}</h2>
              {net !== 0 && (
                <span className={`text-sm font-semibold ${net > 0 ? "text-good" : "text-danger"}`}>
                  {net > 0 ? "+" : "−"}
                  {money(Math.abs(net))}
                </span>
              )}
            </div>
            <ul className="card divide-y divide-border px-4 py-1">
              {rows.map((t) => (
                <TxnRow key={t.id} t={t} cats={cats} accounts={accounts} onChanged={changed} />
              ))}
            </ul>
          </section>
        );
      })}
      {txns.data && txns.data.total > items.length && (
        <p className="text-center text-xs text-muted">Showing the latest {items.length} of {txns.data.total}. Use filters to narrow it down.</p>
      )}
      {txns.data && items.length === 0 && <p className="card text-center text-sm text-muted">No transactions match.</p>}
    </>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}`, last, firstDow: (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 };
}
function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function nzToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}

/** Month grid of spend per day; tap a day to see its transactions. */
function CalendarView({ cats, accounts }: { cats: Cat[]; accounts: Account[] }) {
  const today = nzToday();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const b = monthBounds(ym);
  const data = useApi<{ days: { date: string; spent: number; income: number; count: number }[] }>(`/api/spending/daily?from=${b.from}&to=${b.to}`);
  const byDate = new Map((data.data?.days ?? []).map((d) => [d.date, d]));
  const max = Math.max(1, ...(data.data?.days ?? []).map((d) => d.spent));
  const total = (data.data?.days ?? []).reduce((a, d) => a + Math.round(d.spent * 100), 0) / 100;
  const dayTxns = useApi<{ items: Txn[] }>(day ? `/api/transactions?from=${day}&to=${day}&limit=200` : null);
  const label = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <button className="icon-btn" onClick={() => { setYm(shiftMonth(ym, -1)); setDay(null); }} aria-label="Previous month">‹</button>
          <div className="text-center">
            <div className="font-semibold">{label}</div>
            <div className="text-xs text-muted">{money(total)} spent</div>
          </div>
          <button className="icon-btn" disabled={ym >= today.slice(0, 7)} onClick={() => { setYm(shiftMonth(ym, 1)); setDay(null); }} aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
          {WEEKDAYS.map((w, i) => <div key={i}>{w}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: b.firstDow }, (_, i) => <div key={`pad${i}`} />)}
          {Array.from({ length: b.last }, (_, i) => {
            const date = `${ym}-${String(i + 1).padStart(2, "0")}`;
            const d = byDate.get(date);
            const heat = d && d.spent > 0 ? 0.12 + 0.6 * (d.spent / max) : 0;
            const future = date > today;
            return (
              <button
                key={date}
                disabled={future}
                onClick={() => setDay(day === date ? null : date)}
                aria-pressed={day === date}
                aria-label={`${date}: ${d ? money(d.spent) : "no"} spending`}
                className={`flex aspect-square flex-col items-center justify-center rounded-xl text-xs ${day === date ? "ring-2 ring-accent" : ""} ${future ? "opacity-30" : ""}`}
                style={{ background: heat ? `color-mix(in srgb, var(--accent) ${Math.round(heat * 100)}%, transparent)` : "var(--surface-2)" }}
              >
                <span className={date === today ? "font-bold text-accent" : ""}>{i + 1}</span>
                {d && d.spent > 0 && <span className="text-[10px] leading-tight">${d.spent >= 1000 ? `${(d.spent / 1000).toFixed(1)}k` : Math.round(d.spent)}</span>}
              </button>
            );
          })}
        </div>
      </section>
      {day && (
        <section>
          <h2 className="mb-2 px-1 font-semibold">{dayLabel(day)}</h2>
          {!dayTxns.data && <div className="card h-24 animate-pulse" />}
          {dayTxns.data && dayTxns.data.items.length === 0 && <p className="card text-sm text-muted">Nothing on this day.</p>}
          {dayTxns.data && dayTxns.data.items.length > 0 && (
            <ul className="card divide-y divide-border px-4 py-1">
              {dayTxns.data.items.map((t) => (
                <TxnRow key={t.id} t={t} cats={cats} accounts={accounts} onChanged={() => { dayTxns.reload(); data.reload(); }} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

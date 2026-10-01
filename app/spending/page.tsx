"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/components/useApi";
import TxnRow from "@/components/TxnRow";
import { money, shortDate } from "@/lib/client";
import type { Account, Cat, Txn } from "@/components/types";

type Part = { name: string; spent: number; count: number; pct: number | null };
type Breakdown = {
  category: { id: string | null; name: string; color: string | null };
  from: string;
  to: string;
  total: number;
  count: number;
  merchants: Part[];
  subcategories: Part[];
  trip_excluded: number;
  items: { id: string; spent: number; merchant: string }[];
};

/** What makes up one category's spend for a period (opened from the home-page bars). */
export default function SpendingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Spending />
    </Suspense>
  );
}

function Spending() {
  const sp = useSearchParams();
  const category = sp.get("category") ?? "uncategorised";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const period = sp.get("period");
  const qs = new URLSearchParams({ category, from, to }).toString();
  const data = useApi<Breakdown>(`/api/dashboard/category?${qs}`);
  const txns = useApi<{ items: Txn[] }>(`/api/transactions?${qs}&limit=1000`);
  const cats = useApi<{ categories: Cat[] }>("/api/categories");
  const accounts = useApi<Account[]>("/api/accounts");
  const [merchant, setMerchant] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const b = data.data;
  const byId = new Map((txns.data?.items ?? []).map((t) => [t.id, t]));
  const rows = (b?.items ?? [])
    .filter((i) => !merchant || i.merchant === merchant)
    .map((i) => byId.get(i.id))
    .filter((t): t is Txn => !!t);
  const color = b?.category.color ?? "var(--muted)";

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-accent">← Home</Link>
      {data.error && <p className="card text-sm text-danger">{data.error}</p>}
      {!b && !data.error && <p className="text-sm text-muted">Loading…</p>}
      {b && (
        <>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} aria-hidden />
              {b.category.name}
            </h1>
            <p className="text-sm text-muted">
              {period ?? `${shortDate(b.from)} – ${shortDate(b.to)}`} · {b.count} transaction{b.count === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{money(b.total)}</p>
            {b.trip_excluded > 0 && (
              <p className="text-xs text-muted">Trip spending kept separate isn’t included (see Trips).</p>
            )}
          </div>

          {b.subcategories.length > 0 && (
            <section className="card">
              <h2 className="mb-2 font-semibold">By subcategory</h2>
              <Parts parts={b.subcategories} color={color} />
            </section>
          )}

          {b.merchants.length > 0 && (
            <section className="card">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">Where it went</h2>
                {merchant && (
                  <button className="text-sm text-accent" onClick={() => setMerchant(null)}>
                    Show all
                  </button>
                )}
              </div>
              <Parts parts={b.merchants} color={color} selected={merchant} onSelect={(m) => setMerchant(m === merchant ? null : m)} />
            </section>
          )}

          <section>
            <h2 className="mb-2 font-semibold">{merchant ? `${merchant} transactions` : "Transactions"}</h2>
            {toast && <p className="mb-2 rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{toast}</p>}
            {!txns.data && <p className="text-sm text-muted">Loading…</p>}
            {txns.data && rows.length === 0 && <p className="card text-sm text-muted">Nothing here.</p>}
            {rows.length > 0 && (
              <ul className="card divide-y divide-border py-1">
                {rows.map((t) => (
                  <TxnRow
                    key={t.id}
                    t={t}
                    cats={cats.data?.categories ?? []}
                    accounts={accounts.data ?? []}
                    onChanged={(msg) => {
                      if (msg) {
                        setToast(msg);
                        setTimeout(() => setToast(null), 4000);
                      }
                      data.reload();
                      txns.reload();
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Parts({ parts, color, selected, onSelect }: { parts: Part[]; color: string; selected?: string | null; onSelect?: (name: string) => void }) {
  return (
    <ul className="space-y-2">
      {parts.map((p) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">
                {p.name}
                {p.count > 1 && <span className="ml-1 text-xs text-muted">×{p.count}</span>}
              </span>
              <span className="shrink-0 tabular-nums">
                {money(p.spent)}
                {p.pct != null && <span className="ml-1 text-xs text-muted">{p.pct}%</span>}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, p.pct ?? 0))}%`, background: color }} />
            </div>
          </>
        );
        return (
          <li key={p.name}>
            {onSelect ? (
              <button
                type="button"
                className={`block w-full rounded-lg px-1 py-0.5 text-left ${selected === p.name ? "bg-accent-soft" : ""}`}
                onClick={() => onSelect(p.name)}
                aria-pressed={selected === p.name}
              >
                {body}
              </button>
            ) : (
              <div className="px-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

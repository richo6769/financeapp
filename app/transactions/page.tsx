"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/components/useApi";
import TxnRow from "@/components/TxnRow";
import AddCash from "@/components/AddCash";
import type { Account, Cat, Txn } from "@/components/types";

export default function Transactions() {
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (account) p.set("account", account);
    if (category) p.set("category", category);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", "300");
    return p.toString();
  }, [q, account, category, from, to]);

  const txns = useApi<{ total: number; items: Txn[] }>(`/api/transactions?${qs}`);
  const cats = useApi<{ categories: Cat[] }>("/api/categories");
  const accounts = useApi<Account[]>("/api/accounts");
  const catList = cats.data?.categories ?? [];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1" placeholder="Search merchant or description" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        <button className="btn" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{account || category || from || to ? " •" : ""}
        </button>
      </div>
      {showFilters && (
        <div className="card grid grid-cols-2 gap-2">
          <label className="col-span-2 text-xs text-muted">
            Account
            <select className="input mt-1 w-full py-1 text-sm" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 text-xs text-muted">
            Category
            <select className="input mt-1 w-full py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              <option value="uncategorised">Uncategorised</option>
              {catList.filter((c) => !c.parent_id).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">From<input type="date" className="input mt-1 w-full py-1 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs text-muted">To<input type="date" className="input mt-1 w-full py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn col-span-2" onClick={() => { setAccount(""); setCategory(""); setFrom(""); setTo(""); }}>Clear filters</button>
        </div>
      )}
      <AddCash cats={catList} onAdded={() => txns.reload()} />
      {toast && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{toast}</p>}
      {txns.error && <p className="card text-danger">{txns.error}</p>}
      <div className="card py-1">
        <p className="pt-2 text-xs text-muted">{txns.data ? `${txns.data.total} transactions${txns.data.total > txns.data.items.length ? ` (showing ${txns.data.items.length})` : ""}` : "Loading…"}</p>
        <ul className="divide-y divide-border">
          {(txns.data?.items ?? []).map((t) => (
            <TxnRow
              key={`${t.id}:${t.category_id}`}
              t={t}
              cats={catList}
              accounts={accounts.data ?? []}
              onChanged={(msg) => {
                if (msg) {
                  setToast(msg);
                  setTimeout(() => setToast(null), 4000);
                }
                txns.reload();
              }}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

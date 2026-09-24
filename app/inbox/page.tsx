"use client";

import { useState } from "react";
import { useApi } from "@/components/useApi";
import TxnRow from "@/components/TxnRow";
import Suggestions from "@/components/Suggestions";
import type { Account, Cat, Txn } from "@/components/types";

/** Quick triage of uncategorised transactions. */
export default function Inbox() {
  const txns = useApi<{ total: number; items: Txn[] }>("/api/transactions?category=uncategorised&limit=100");
  const cats = useApi<{ categories: Cat[] }>("/api/categories");
  const accounts = useApi<Account[]>("/api/accounts");
  const [toast, setToast] = useState<string | null>(null);
  const items = txns.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Suggestions />
      <div>
        <h1 className="text-xl font-semibold">Uncategorised</h1>
        <p className="text-sm text-muted">
          {txns.data ? `${txns.data.total} to triage.` : "Loading…"} Pick a category; choose “Apply to all” to create a rule so it never comes back.
        </p>
      </div>
      {toast && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{toast}</p>}
      {txns.data && items.length === 0 && <p className="card text-center text-sm">🎉 Inbox zero — everything is categorised.</p>}
      {items.length > 0 && (
        <ul className="card divide-y divide-border py-1">
          {items.map((t) => (
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
                txns.reload();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

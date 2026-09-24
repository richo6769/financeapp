"use client";

import { useState } from "react";
import { api, money, shortDate } from "@/lib/client";
import CategorySelect from "./CategorySelect";
import type { Account, Cat, Txn } from "./types";

/**
 * One transaction with inline recategorise. After changing a category we offer
 * "apply to all from this merchant", which also creates a rule.
 */
export default function TxnRow({
  t,
  cats,
  accounts,
  onChanged,
}: {
  t: Txn;
  cats: Cat[];
  accounts: Account[];
  onChanged: (msg?: string) => void;
}) {
  const [cat, setCat] = useState(t.category_id);
  const [offer, setOffer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const acct = accounts.find((a) => a.id === t.account_id);
  const who = t.merchant_name ?? t.description;

  async function save(id: string | null, applyAll: boolean) {
    setBusy(true);
    try {
      const r = await api<{ updated: number; rule?: string }>(`/api/transactions/${t.id}`, {
        method: "PATCH",
        json: { category_id: id, apply_to_merchant: applyAll },
      });
      if (applyAll) {
        setOffer(null);
        onChanged(`Updated ${r.updated} transactions · rule ${r.rule}`);
      } else {
        setOffer(id);
        if (!id) onChanged();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{who}</div>
          <div className="truncate text-xs text-muted">
            {shortDate(t.local_date)} · {t.is_manual ? "Cash" : (acct?.name ?? "—")}
            {t.merchant_name && t.merchant_name !== t.description ? ` · ${t.description}` : ""}
          </div>
        </div>
        <div className={`shrink-0 text-sm font-semibold ${t.amount > 0 ? "text-good" : ""}`}>
          {t.amount > 0 ? "+" : ""}
          {money(t.amount)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CategorySelect
          cats={cats}
          value={cat}
          onChange={(id) => {
            setCat(id);
            save(id, false);
          }}
          className="max-w-[60%]"
          ariaLabel={`Category for ${who}`}
        />
        {t.is_transfer && <span className="chip">transfer · excluded</span>}
        {t.category_source && t.category_source !== "manual" && !t.is_transfer && (
          <span className="chip" title="How this was categorised">{t.category_source}</span>
        )}
        {busy && <span className="text-xs text-muted">Saving…</span>}
      </div>
      {offer && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft p-2 text-xs">
          <span>Apply to all from “{who}” and create a rule?</span>
          <button className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => save(offer, true)}>
            Apply to all
          </button>
          <button
            className="btn px-2 py-1 text-xs"
            onClick={() => {
              setOffer(null);
              onChanged();
            }}
          >
            Just this one
          </button>
        </div>
      )}
    </li>
  );
}

"use client";

import { useState } from "react";
import { api, money, shortDate } from "@/lib/client";
import CategorySelect from "./CategorySelect";
import NetOffPanel from "./NetOffPanel";
import type { Account, Cat, Txn } from "./types";

/**
 * One transaction with inline recategorise. After changing a category we offer
 * "apply to all from this merchant", which also creates a rule. Expenses can
 * be netted off against incoming money (see NetOffPanel).
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
  const [netOff, setNetOff] = useState(false);
  const [iouOpen, setIouOpen] = useState(false);
  const [iouName, setIouName] = useState("");
  const [iouAmount, setIouAmount] = useState("");

  async function addIou() {
    try {
      await api("/api/ious", { method: "POST", json: { expense_id: t.id, person_name: iouName, amount: iouAmount || null } });
      setIouOpen(false);
      setIouName("");
      setIouAmount("");
      onChanged(`IOU added: ${iouName} owes you ${iouAmount ? money(Number(iouAmount)) : money(Math.abs(t.amount))}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }
  const netted = t.amount < 0 && t.reimbursed_by.length > 0;

  async function unlink(linkId: string) {
    try {
      await api(`/api/reimbursements/${linkId}`, { method: "DELETE" });
      onChanged("Unlinked");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }

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
          {t.foreign_currency && t.foreign_amount != null && (
            <div className="text-xs text-muted">
              {t.foreign_currency} {t.foreign_amount.toLocaleString("en-NZ", { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
        <div className={`shrink-0 text-right text-sm font-semibold ${t.removed_at ? "text-muted line-through" : t.amount > 0 ? "text-good" : ""}`}>
          {netted ? (
            <>
              <span className="font-normal text-muted line-through">{money(Math.abs(t.amount))}</span> → {money(Math.abs(t.net_amount))}
              <div className="text-[11px] font-normal text-muted">net</div>
            </>
          ) : (
            <>
              {t.amount > 0 ? "+" : ""}
              {money(t.amount)}
            </>
          )}
        </div>
      </div>
      {t.reimbursed_by.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {t.reimbursed_by.map((l) => (
            <li key={l.link_id}>
              Paid back {money(l.amount)} by <b className="text-ink">{l.other_name}</b> ({shortDate(l.other_date)}) ·{" "}
              <button className="underline" onClick={() => unlink(l.link_id)}>Unlink</button>
            </li>
          ))}
        </ul>
      )}
      {t.linked_to.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {t.linked_to.map((l) => (
            <li key={l.link_id}>
              Linked {money(l.amount)} to <b className="text-ink">{l.other_name}</b> ({shortDate(l.other_date)}) ·{" "}
              <button className="underline" onClick={() => unlink(l.link_id)}>Unlink</button>
            </li>
          ))}
          {t.unallocated != null && t.unallocated > 0 && <li>{money(t.unallocated)} unallocated</li>}
        </ul>
      )}
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
        {t.removed_at && <span className="chip" title="The bank removed this after it settled; it's excluded from totals">removed by bank</span>}
        {t.trip && <a href={`/trips/${t.trip.id}`} className="chip">✈ {t.trip.name}</a>}
        {t.ious.map((i) => (
          <a key={i.id} href="/owed" className="chip">
            {i.status === "settled" ? "✓ " : ""}{i.person_name} owes {money(i.status === "settled" ? i.amount : i.balance)}
          </a>
        ))}
        {t.category_source && t.category_source !== "manual" && !t.is_transfer && (
          <span className="chip" title="How this was categorised">{t.category_source}</span>
        )}
        {t.amount < 0 && !t.is_transfer && !t.removed_at && Math.abs(t.net_amount) > 0 && (
          <>
            <button className="btn px-2 py-1 text-xs" onClick={() => setNetOff((v) => !v)} aria-expanded={netOff}>
              Net off
            </button>
            <button className="btn px-2 py-1 text-xs" onClick={() => setIouOpen((v) => !v)} aria-expanded={iouOpen}>
              IOU
            </button>
          </>
        )}
        {busy && <span className="text-xs text-muted">Saving…</span>}
      </div>
      {iouOpen && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2 p-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            addIou();
          }}
        >
          <input className="input min-w-0 flex-1 py-1 text-sm" placeholder="Who owes you? e.g. Sam" value={iouName} onChange={(e) => setIouName(e.target.value)} required maxLength={60} autoFocus />
          <input className="input w-24 py-1 text-sm" inputMode="decimal" placeholder={Math.abs(t.amount).toFixed(2)} value={iouAmount} onChange={(e) => setIouAmount(e.target.value)} aria-label="Amount owed" />
          <button className="btn-primary px-2 py-1 text-xs">Save</button>
          <button type="button" className="text-muted" onClick={() => setIouOpen(false)} aria-label="Close">✕</button>
        </form>
      )}
      {netOff && (
        <NetOffPanel
          expense={t}
          onClose={() => setNetOff(false)}
          onLinked={(msg) => {
            setNetOff(false);
            onChanged(msg);
          }}
        />
      )}
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

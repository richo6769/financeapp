"use client";

import { useEffect, useState } from "react";
import { api, money, shortDate } from "@/lib/client";
import CategorySelect from "./CategorySelect";
import NetOffPanel from "./NetOffPanel";
import { merchantPattern } from "@/lib/categorise";
import { categoryIcon } from "@/lib/catIcons";
import Avatar, { CatDot } from "./Avatar";
import type { Account, Cat, Txn } from "./types";

/**
 * One transaction: logo, name, category and amount. Tap to open the edit
 * panel (category, Net off, IOU, links). Uncategorised rows show the category
 * picker straight away. After changing a category we offer "apply to all from
 * this merchant", which also creates a rule.
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
  // Follow the server's value after reloads (e.g. "Apply to all" changed this row too).
  useEffect(() => setCat(t.category_id), [t.category_id]);
  const [offer, setOffer] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
      if (!applyAll) setCat(t.category_id); // the change didn't stick: show what's saved
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const needsCat = !t.netted_off && !t.is_transfer && !cat;
  const catName = cats.find((c) => c.id === cat)?.name ?? t.category_label;
  const parentOf = (id: string | null) => {
    const c = cats.find((x) => x.id === id);
    return c?.parent_id ? cats.find((x) => x.id === c.parent_id) : c;
  };
  const root = parentOf(cat);
  const color = root?.color ?? t.category_color ?? null;
  const dim = t.is_transfer || !!t.removed_at;
  const guessed = t.category_source === "akahu" || t.category_source === "merchant";

  return (
    <li className={`py-2.5 ${dim ? "opacity-55" : ""}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex cursor-pointer items-start gap-3 rounded-2xl"
      >
        <Avatar name={who} logo={t.logo} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[15px] font-semibold ${t.is_transfer ? "line-through decoration-1" : ""}`}>{who}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted">
            {t.netted_off ? (
              <>
                <CatDot icon="✓" color="#5fd08a" />
                <span className="truncate">{t.netted_categories.length ? `${t.netted_categories.join(", ")} · netted off` : "Netted off"}</span>
              </>
            ) : needsCat ? (
              <span onClick={(e) => e.stopPropagation()} className="min-w-0">
                <CategorySelect
                  cats={cats}
                  value={cat}
                  onChange={(id) => {
                    setCat(id);
                    save(id, false);
                  }}
                  className="max-w-[12rem] py-0.5 text-xs"
                  ariaLabel={`Category for ${who}${t.unallocated ? " (unallocated part)" : ""}`}
                />
              </span>
            ) : (
              <>
                <CatDot icon={categoryIcon(root?.name ?? catName, root?.kind ?? t.category_kind)} color={color} />
                <span className="truncate">{catName}</span>
              </>
            )}
          </div>
          {(guessed || t.ious.length > 0 || t.trip || t.foreign_currency || t.removed_at || (t.unallocated != null && t.unallocated > 0)) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {guessed && !t.is_transfer && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink" title="Categorised automatically — tap to change">
                  ✨ Auto
                </span>
              )}
              {t.ious.map((i) => (
                <span key={i.id} className="rounded-full border border-[#60a5fa]/40 px-2 py-0.5 text-[11px] font-semibold text-[#60a5fa]">
                  ● {i.status === "settled" ? `${i.person_name} paid` : `${i.person_name} owes ${money(i.balance)}`}
                </span>
              ))}
              {t.trip && <span className="chip">✈ {t.trip.name}</span>}
              {t.foreign_currency && t.foreign_amount != null && (
                <span className="chip">
                  {t.foreign_currency} {t.foreign_amount.toLocaleString("en-NZ", { maximumFractionDigits: 2 })}
                </span>
              )}
              {t.unallocated != null && t.unallocated > 0 && <span className="chip">{money(t.unallocated)} unallocated</span>}
              {t.removed_at && <span className="chip">removed by bank</span>}
            </div>
          )}
        </div>
        <div className={`shrink-0 text-right text-[15px] font-semibold ${t.removed_at ? "line-through" : t.amount > 0 ? "text-good" : "text-danger"}`}>
          {netted ? (
            <>
              {money(-Math.abs(t.net_amount))}
              <div className="text-[11px] font-normal text-muted line-through">{money(t.amount)}</div>
            </>
          ) : (
            <>
              {t.amount > 0 ? "+" : ""}
              {money(t.amount)}
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded-2xl border border-border bg-surface-2 p-3 text-sm">
          <div className="text-xs text-muted">
            {shortDate(t.local_date)} · {t.is_manual ? "Cash" : (acct?.name ?? "—")}
            {t.merchant_name && t.merchant_name !== t.description ? ` · ${t.description}` : ""}
            {t.is_transfer && <> · {t.category_kind === "savings" ? "savings, not spending" : "transfer, excluded from totals"}</>}
            {t.category_source && t.category_source !== "manual" && <> · categorised by {t.category_source}</>}
          </div>
          {t.reimbursed_by.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted">
              {t.reimbursed_by.map((l) => (
                <li key={l.link_id}>
                  Paid back {money(l.amount)} by <b className="text-ink">{l.other_name}</b> ({shortDate(l.other_date)}) ·{" "}
                  <button className="underline" onClick={() => unlink(l.link_id)}>Unlink</button>
                </li>
              ))}
            </ul>
          )}
          {t.linked_to.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted">
              {t.linked_to.map((l) => (
                <li key={l.link_id}>
                  Linked {money(l.amount)} to <b className="text-ink">{l.other_name}</b> ({shortDate(l.other_date)}) ·{" "}
                  <button className="underline" onClick={() => unlink(l.link_id)}>Unlink</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!t.netted_off && (
              <CategorySelect
                cats={cats}
                value={cat}
                onChange={(id) => {
                  setCat(id);
                  save(id, false);
                }}
                className="max-w-[60%]"
                ariaLabel={`Change category for ${who}`}
              />
            )}
            {t.amount < 0 && !t.is_transfer && !t.removed_at && Math.abs(t.net_amount) > 0 && (
              <>
                <button className="btn px-3 py-1 text-xs" onClick={() => setNetOff((v) => !v)} aria-expanded={netOff}>
                  Net off
                </button>
                <button className="btn px-3 py-1 text-xs" onClick={() => setIouOpen((v) => !v)} aria-expanded={iouOpen}>
                  IOU
                </button>
              </>
            )}
            {busy && <span className="text-xs text-muted">Saving…</span>}
          </div>
        </div>
      )}
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
          <span>Apply to all matching “{merchantPattern(t).pattern}” and create a rule?</span>
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

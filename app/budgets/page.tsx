"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/components/useApi";
import { api, money } from "@/lib/client";
import type { Cat } from "@/components/types";

type Budget = { category_id: string; amount_monthly: number; period: string; period_amount: number };
type Data = { categories: Cat[]; budgets: Budget[]; overall_monthly_cap: number | null };
type Caps = { all: { category_id: string; amount: number }[]; caps: { category_id: string; spent: number; pct: number; level: string }[] };
const PERIODS = ["monthly", "weekly", "fortnightly", "yearly"] as const;

export default function Budgets() {
  const { data, error, reload } = useApi<Data>("/api/categories");
  const caps = useApi<Caps>("/api/caps");
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 5000);
  };

  if (error) return <p className="card text-danger">{error}</p>;
  if (!data) return <div className="card h-40 animate-pulse" />;
  const roots = data.categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
  const totalBudgets = data.budgets.reduce((a, b) => a + b.amount_monthly, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Budgets & caps</h1>
          <p className="text-sm text-muted">Category budgets total {money(totalBudgets, true)}/month.</p>
        </div>
        <Link href="/rules" className="btn">Rules →</Link>
      </div>
      {msg && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{msg}</p>}

      <OverallCap value={data.overall_monthly_cap} onSaved={(m) => { flash(m); reload(); }} />

      <ul className="card divide-y divide-border py-1">
        {roots.map((r) => (
          <li key={r.id} className="py-2">
            <CategoryRow cat={r} budget={data.budgets.find((b) => b.category_id === r.id)} onChanged={(m) => { if (m) flash(m); reload(); }} />
            {r.kind === "expense" && (
              <WeeklyCap
                categoryId={r.id}
                name={r.name}
                value={caps.data?.all.find((c) => c.category_id === r.id)?.amount ?? null}
                status={caps.data?.caps.find((c) => c.category_id === r.id)}
                onSaved={(m) => { flash(m); caps.reload(); }}
              />
            )}
            {data.categories
              .filter((s) => s.parent_id === r.id)
              .map((s) => (
                <div key={s.id} className="ml-5 border-l border-border pl-3">
                  <CategoryRow cat={s} budget={data.budgets.find((b) => b.category_id === s.id)} onChanged={(m) => { if (m) flash(m); reload(); }} />
                </div>
              ))}
          </li>
        ))}
      </ul>

      <form
        className="card grid grid-cols-2 gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/categories", { method: "POST", json: { name: newName, parent_id: newParent || null } });
            setNewName("");
            setNewParent("");
            reload();
          } catch (err) {
            flash(err instanceof Error ? err.message : "Failed");
          }
        }}
      >
        <h2 className="col-span-2 font-semibold">Add category</h2>
        <input className="input" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} required />
        <select className="input text-sm" value={newParent} onChange={(e) => setNewParent(e.target.value)} aria-label="Parent category">
          <option value="">Top level</option>
          {roots.map((r) => <option key={r.id} value={r.id}>Under {r.name}</option>)}
        </select>
        <button className="btn-primary col-span-2">Add</button>
      </form>
    </div>
  );
}

function OverallCap({ value, onSaved }: { value: number | null; onSaved: (m: string) => void }) {
  const [amount, setAmount] = useState(value?.toString() ?? "");
  const [period, setPeriod] = useState("monthly");
  return (
    <form
      className="card flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await api<{ explanation: string }>("/api/budgets", { method: "PUT", json: { overall: true, amount: amount === "" ? null : Number(amount), period } });
        onSaved(`Overall cap: ${r.explanation}`);
      }}
    >
      <span className="w-full text-sm font-semibold">Overall monthly cap <span className="font-normal text-muted">(optional)</span></span>
      <input className="input w-28" inputMode="decimal" placeholder="None" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Overall cap amount" />
      <select className="input text-sm" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Cap period">
        {PERIODS.map((p) => <option key={p}>{p}</option>)}
      </select>
      <button className="btn">Save</button>
    </form>
  );
}

function CategoryRow({ cat, budget, onChanged }: { cat: Cat; budget?: Budget; onChanged: (m?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [amount, setAmount] = useState(budget ? String(budget.period_amount) : "");
  const [period, setPeriod] = useState(budget?.period ?? "monthly");
  const dirty = amount !== (budget ? String(budget.period_amount) : "") || period !== (budget?.period ?? "monthly");

  async function saveBudget() {
    const r = await api<{ explanation?: string }>("/api/budgets", {
      method: "PUT",
      json: { category_id: cat.id, amount: amount === "" ? null : Number(amount), period },
    });
    onChanged(r.explanation ? `${cat.name}: ${r.explanation}` : `${cat.name}: budget removed`);
  }

  async function remove() {
    const preview = await api<{ preview: { transactions_affected: number; rules_removed: number; subcategories: string[] } }>(`/api/categories/${cat.id}`, { method: "DELETE" });
    const p = preview.preview;
    const ok = confirm(
      `Delete "${cat.name}"${p.subcategories.length ? ` and its subcategories (${p.subcategories.join(", ")})` : ""}?\n\n${p.transactions_affected} transactions will become uncategorised and ${p.rules_removed} rules will be removed.`,
    );
    if (!ok) return;
    await api(`/api/categories/${cat.id}?confirm=1`, { method: "DELETE" });
    onChanged(`Deleted ${cat.name}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      {editing ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api(`/api/categories/${cat.id}`, { method: "PATCH", json: { name } });
            setEditing(false);
            onChanged();
          }}
        >
          <input className="input min-w-0 flex-1 py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Category name" />
          <button className="btn py-1 text-xs">Save</button>
        </form>
      ) : (
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium" onClick={() => setEditing(true)} title="Rename">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color ?? "var(--muted)" }} aria-hidden />
          <span className="truncate">{cat.name}</span>
          {cat.kind !== "expense" && <span className="chip">{cat.kind}</span>}
        </button>
      )}
      {cat.kind === "expense" && (
        <div className="flex items-center gap-1">
          <input className="input w-20 py-1 text-sm" inputMode="decimal" placeholder="Budget" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`${cat.name} budget`} />
          <select className="input py-1 text-xs" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={`${cat.name} budget period`}>
            {PERIODS.map((p) => <option key={p} value={p}>{p === "monthly" ? "/mo" : p === "weekly" ? "/wk" : p === "fortnightly" ? "/fn" : "/yr"}</option>)}
          </select>
          {dirty && <button className="btn-primary px-2 py-1 text-xs" onClick={saveBudget}>Save</button>}
        </div>
      )}
      {budget && budget.period !== "monthly" && <span className="w-full pl-5 text-xs text-muted">= {money(budget.amount_monthly)}/month</span>}
      {!cat.is_system && (
        <button className="text-xs text-muted hover:text-danger" onClick={remove} aria-label={`Delete ${cat.name}`}>Delete</button>
      )}
    </div>
  );
}

function WeeklyCap({
  categoryId,
  name,
  value,
  status,
  onSaved,
}: {
  categoryId: string;
  name: string;
  value: number | null;
  status?: { spent: number; pct: number; level: string };
  onSaved: (m: string) => void;
}) {
  const [amount, setAmount] = useState(value == null ? "" : String(value));
  const dirty = amount !== (value == null ? "" : String(value));
  return (
    <div className="flex items-center justify-end gap-1 pb-1 pl-5 text-xs text-muted">
      <span className="mr-auto">
        Weekly cap{status && <> · {money(status.spent)} this week ({status.pct}%)</>}
      </span>
      <input className="input w-20 py-0.5 text-xs" inputMode="decimal" placeholder="none" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`${name} weekly cap`} />
      <span>/wk</span>
      {dirty && (
        <button
          className="btn-primary px-2 py-0.5 text-xs"
          onClick={async () => {
            try {
              await api("/api/caps", { method: "PUT", json: { category_id: categoryId, amount: amount === "" ? null : Number(amount) } });
              onSaved(amount === "" ? `${name}: weekly cap removed` : `${name}: weekly cap ${money(Number(amount))} (Mon–Sun)`);
            } catch (e) {
              onSaved(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          Save
        </button>
      )}
    </div>
  );
}

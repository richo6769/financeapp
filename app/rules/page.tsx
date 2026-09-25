"use client";

import { useState } from "react";
import { useApi } from "@/components/useApi";
import CategorySelect from "@/components/CategorySelect";
import { api } from "@/lib/client";
import type { Cat } from "@/components/types";

type Rule = { id: string; pattern: string; field: string; match_type: string; category_label: string; priority: number };

export default function Rules() {
  const rules = useApi<Rule[]>("/api/rules");
  const cats = useApi<{ categories: Cat[] }>("/api/categories");
  const [pattern, setPattern] = useState("");
  const [field, setField] = useState("any");
  const [cat, setCat] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function add(confirmed = false) {
    if (!cat) return setMsg("Pick a category");
    const r = await api<{ needs_confirmation: boolean; matched_existing: number; applied: number }>("/api/rules", {
      method: "POST",
      json: { pattern, field, category_id: cat, apply_to_existing: true, confirmed },
    });
    if (r.needs_confirmation) {
      if (confirm(`This rule would recategorise ${r.matched_existing} past transactions. Continue?`)) return add(true);
      return;
    }
    setMsg(`Rule added · ${r.applied} past transactions updated`);
    setPattern("");
    rules.reload();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Rules</h1>
        <p className="text-sm text-muted">Matched against merchant/description (case and punctuation ignored). First match wins, newest first. Rules beat Akahu’s suggestions; your manual choices beat rules.</p>
      </div>
      {msg && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{msg}</p>}
      <form className="card grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); add().catch((err) => setMsg(err.message)); }}>
        <input className="input col-span-2" placeholder="Pattern, e.g. Z Energy" value={pattern} onChange={(e) => setPattern(e.target.value)} required />
        <select className="input text-sm" value={field} onChange={(e) => setField(e.target.value)} aria-label="Match field">
          <option value="any">Merchant or description</option>
          <option value="merchant">Merchant only</option>
          <option value="description">Description only</option>
        </select>
        <CategorySelect cats={cats.data?.categories ?? []} value={cat} onChange={setCat} includeUncategorised={false} />
        <button className="btn-primary col-span-2">Add rule</button>
      </form>
      <ul className="card divide-y divide-border py-1">
        {(rules.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              <b>{r.pattern}</b> <span className="text-muted">→</span> {r.category_label}
              {r.field !== "any" && <span className="chip ml-1">{r.field}</span>}
            </span>
            <button
              className="text-xs text-muted hover:text-danger"
              onClick={async () => {
                await api(`/api/rules/${r.id}`, { method: "DELETE" });
                rules.reload();
              }}
            >
              Delete
            </button>
          </li>
        ))}
        {rules.data?.length === 0 && <li className="py-2 text-sm text-muted">No rules yet.</li>}
      </ul>
    </div>
  );
}

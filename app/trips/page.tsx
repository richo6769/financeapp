"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/components/useApi";
import { api, money, shortDate } from "@/lib/client";

type TripRow = { id: string; name: string; start_date: string; end_date: string; budget: number | null; status: string; spent: number; remaining: number | null; days_left: number };

export default function Trips() {
  const { data, error, reload } = useApi<TripRow[]>("/api/trips");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [budget, setBudget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (error) return <p className="card text-danger">{error}</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Trips</h1>
        <p className="text-sm text-muted">Foreign-currency and Travel transactions in the dates are tagged automatically. By default trip spending is kept out of your monthly budgets.</p>
      </div>
      <ul className="space-y-2">
        {(data ?? []).map((t) => (
          <li key={t.id}>
            <Link href={`/trips/${t.id}`} className="card block">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{t.name}</span>
                <span className="chip">{t.status}</span>
              </div>
              <div className="text-xs text-muted">{shortDate(t.start_date)} – {shortDate(t.end_date)}</div>
              <div className="mt-1 text-sm">
                {money(t.spent)}{t.budget != null && <> of {money(t.budget)} · <span className={t.remaining != null && t.remaining < 0 ? "text-danger" : ""}>{money(t.remaining ?? 0)} left</span></>}
              </div>
            </Link>
          </li>
        ))}
        {data?.length === 0 && <li className="card text-sm text-muted">No trips yet.</li>}
      </ul>
      <form
        className="card grid grid-cols-2 gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await api("/api/trips", { method: "POST", json: { name, start_date: start, end_date: end, budget: budget || null } });
            setName("");
            setBudget("");
            reload();
          } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : "Failed");
          }
        }}
      >
        <h2 className="col-span-2 font-semibold">New trip</h2>
        <input className="input col-span-2" placeholder="Name, e.g. SEA trip" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        <label className="text-xs text-muted">Start<input type="date" className="input mt-1 w-full py-1 text-sm" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label className="text-xs text-muted">End<input type="date" className="input mt-1 w-full py-1 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
        <input className="input col-span-2" inputMode="decimal" placeholder="Budget (optional)" value={budget} onChange={(e) => setBudget(e.target.value)} />
        {err && <p className="col-span-2 text-sm text-danger">{err}</p>}
        <button className="btn-primary col-span-2">Create trip</button>
      </form>
    </div>
  );
}

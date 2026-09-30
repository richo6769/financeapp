"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import CategorySelect from "./CategorySelect";
import type { Cat } from "./types";

export default function AddCash({ cats, onAdded }: { cats: Cat[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button className="btn w-full" onClick={() => setOpen(true)}>
        + Add cash expense
      </button>
    );
  }
  return (
    <form
      className="card grid grid-cols-2 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/api/transactions", { method: "POST", json: { description: desc, amount: Number(amount), date: date || undefined, category: cat ?? undefined } });
          setDesc("");
          setAmount("");
          setOpen(false);
          onAdded();
        } catch (err) {
          alert(err instanceof Error ? err.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="input col-span-2" placeholder="What for? e.g. Haircut" value={desc} onChange={(e) => setDesc(e.target.value)} required />
      <input className="input" placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required pattern="[0-9]+(\.[0-9]{1,2})?" />
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date (default today)" />
      <CategorySelect cats={cats} value={cat} onChange={setCat} className="col-span-2" />
      <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
      <button className="btn-primary" disabled={busy}>Add</button>
    </form>
  );
}

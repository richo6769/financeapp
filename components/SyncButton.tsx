"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export const SYNC_EVENT = "ledger:synced";

export default function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const log = await api<{ status: string; transactions_new: number; error: string | null }>("/api/sync", { method: "POST" });
      if (log.status !== "success") {
        setFailed(log.error ?? "Sync failed");
        return;
      }
      setFailed(null);
      setMsg(`+${log.transactions_new} new`);
      window.dispatchEvent(new Event(SYNC_EVENT));
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }
  return (
    <div className="flex items-center gap-2">
      {failed && (
        <a href="/settings" className="max-w-[40vw] truncate text-xs text-danger" role="alert" title={failed}>
          ⚠ Sync failed
        </a>
      )}
      {msg && <span className="text-xs text-muted" role="status">{msg}</span>}
      <button className="btn" onClick={sync} disabled={busy}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={busy ? "animate-spin" : ""} aria-hidden>
          <path d="M20 12a8 8 0 01-14.9 4M4 12a8 8 0 0114.9-4M19 3v5h-5M5 21v-5h5" />
        </svg>
        {busy ? "Syncing" : "Sync now"}
      </button>
    </div>
  );
}

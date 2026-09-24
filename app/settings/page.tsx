"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/components/useApi";
import { api, shortDate } from "@/lib/client";
import { SYNC_EVENT } from "@/components/SyncButton";

type Run = { id: string; started_at: string; status: string; trigger: string; mode: string; transactions_new: number; transactions_upserted: number; error: string | null; warnings: string | null };
type History = { runs: Run[]; accounts: { id: string; name: string; institution: string; type: string; missing_since: string | null; updated_at: string }[] };
type Settings = { pay_frequency: string | null; next_payday: string | null; cycle: { start: string; end: string; lengthDays: number } | null };
type Detect = { frequency: string | null; next_payday?: string; last_payday?: string; paydays?: string[] };

const when = (iso: string) => new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" });

export default function SettingsPage() {
  const history = useApi<History>("/api/sync/history");
  const settings = useApi<Settings>("/api/settings");
  const [freq, setFreq] = useState("");
  const [payday, setPayday] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detect | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setFreq(settings.data.pay_frequency ?? "");
      setPayday(settings.data.next_payday ?? "");
    }
  }, [settings.data]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 5000);
  };
  const last = history.data?.runs[0];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sync & settings</h1>
      {msg && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{msg}</p>}

      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Bank sync</h2>
          <button
            className="btn"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              try {
                const r = await api<Run>("/api/sync", { method: "POST" });
                flash(r.status === "success" ? `Synced: +${r.transactions_new} new` : `Sync failed: ${r.error}`);
              } catch (e) {
                flash(e instanceof Error ? e.message : "Sync failed");
              }
              setSyncing(false);
              window.dispatchEvent(new Event(SYNC_EVENT));
            }}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        {last?.status === "error" && (
          <div className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">
            <b>Last sync failed.</b> {last.error}
            <p className="mt-1 text-xs">Your existing data wasn&apos;t changed.</p>
          </div>
        )}
        {last?.warnings && <p className="rounded-xl bg-warn/15 p-2 text-xs text-warn">{last.warnings}</p>}
        <p className="text-xs text-muted">A daily sync also runs automatically at 5–6am NZ time.</p>
        <ul className="divide-y divide-border text-xs">
          {(history.data?.runs ?? []).map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex justify-between gap-2">
                <span>{when(r.started_at)} · {r.trigger} · {r.mode}</span>
                <span className={r.status === "error" ? "text-danger" : r.status === "success" ? "text-good" : "text-muted"}>{r.status}</span>
              </div>
              {r.status === "success" && <div className="text-muted">{r.transactions_new} new · {r.transactions_upserted} checked</div>}
              {r.error && <div className="text-danger">{r.error}</div>}
              {r.warnings && <div className="text-warn">{r.warnings}</div>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Accounts</h2>
        <ul className="divide-y divide-border text-sm">
          {(history.data?.accounts ?? []).map((a) => (
            <li key={a.id} className="flex justify-between gap-2 py-2">
              <span className="min-w-0 truncate">{a.name} <span className="text-muted">· {a.institution}</span></span>
              {a.missing_since ? <span className="chip">missing since {shortDate(a.missing_since.slice(0, 10))}</span> : <span className="text-xs text-muted">{a.type.toLowerCase()}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Pay cycle</h2>
        <p className="text-xs text-muted">Used by the dashboard&apos;s Pay cycle view. Budgets are pro-rated: weekly = monthly × 12/52, fortnightly = monthly × 12/26.</p>
        {settings.data?.cycle && (
          <p className="text-sm">Current cycle: {shortDate(settings.data.cycle.start)} – {shortDate(settings.data.cycle.end)} ({settings.data.cycle.lengthDays} days)</p>
        )}
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/settings", { method: "PUT", json: { pay_frequency: freq || null, next_payday: payday || null } });
              flash(freq ? "Pay cycle saved" : "Pay cycle turned off");
              settings.reload();
            } catch (err) {
              flash(err instanceof Error ? err.message : "Failed");
            }
          }}
        >
          <label className="text-xs text-muted">
            Frequency
            <select className="input mt-1 w-full py-1 text-sm" value={freq} onChange={(e) => setFreq(e.target.value)}>
              <option value="">Off</option>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            Next (or any) payday
            <input type="date" className="input mt-1 w-full py-1 text-sm" value={payday} onChange={(e) => setPayday(e.target.value)} disabled={!freq} />
          </label>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const d = await api<Detect>("/api/settings/detect-pay");
              setDetected(d);
              if (d.frequency && d.next_payday) {
                setFreq(d.frequency);
                setPayday(d.next_payday);
              }
            }}
          >
            Detect from Salary
          </button>
          <button className="btn-primary">Save</button>
        </form>
        {detected && (
          <p className="text-xs text-muted">
            {detected.frequency
              ? `Detected ${detected.frequency} from your Salary-category credits (last paid ${shortDate(detected.last_payday!)}). Check it, then Save.`
              : "Couldn't detect a regular pay pattern yet (needs 3+ Salary credits in the last ~6 months)."}
          </p>
        )}
      </section>
    </div>
  );
}

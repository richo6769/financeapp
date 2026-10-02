"use client";

import { useState } from "react";
import { money, shortDate } from "@/lib/client";

const SPENT = "var(--chart-spent)";
const TO_COME = "var(--accent)";

/**
 * Ring: spent so far + forecast still to come, against the budget limit.
 * Centre shows the forecast (current period) or what was spent (past period).
 */
export function ForecastDonut({
  spent,
  forecast,
  limit,
  current,
}: {
  spent: number;
  forecast: number;
  limit: number | null;
  current: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const R = 80;
  const C = 2 * Math.PI * R;
  const toCome = Math.max(0, forecast - spent);
  const scale = Math.max(limit ?? 0, forecast, spent, 1);
  const gap = 4; // px of surface between segments
  const spentLen = Math.max(0, (Math.max(0, spent) / scale) * C - gap);
  const comeLen = current ? Math.max(0, (toCome / scale) * C - gap) : 0;
  const limitAngle = limit ? (Math.min(limit, scale) / scale) * 360 : null;
  const centre = hover ?? (current ? money(forecast) : money(spent));
  const sub = hover ? "" : current ? "forecast spend" : "spent";

  return (
    <figure className="flex flex-col items-center">
      <div className="relative">
        <svg width="220" height="220" viewBox="0 0 220 220" role="img" aria-label={`Spent ${money(spent)}${current ? `, forecast ${money(forecast)}` : ""}${limit ? ` of a ${money(limit)} limit` : ""}`}>
          <g transform="translate(110 110) rotate(-90)">
            <circle r={R} fill="none" stroke="var(--track)" strokeWidth="22" />
            {spentLen > 0 && (
              <circle
                r={R}
                fill="none"
                stroke={SPENT}
                strokeWidth="22"
                strokeLinecap="round"
                strokeDasharray={`${spentLen} ${C}`}
                onPointerEnter={() => setHover(`${money(spent)} spent`)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{`Spent ${money(spent)}`}</title>
              </circle>
            )}
            {comeLen > 0 && (
              <circle
                r={R}
                fill="none"
                stroke={TO_COME}
                strokeWidth="22"
                strokeLinecap="round"
                strokeDasharray={`${comeLen} ${C}`}
                strokeDashoffset={-(spentLen + gap)}
                onPointerEnter={() => setHover(`${money(toCome)} to come`)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{`Still to come ${money(toCome)}`}</title>
              </circle>
            )}
            {limitAngle != null && limitAngle < 360 && (
              <line
                x1={R - 11}
                x2={R + 11}
                y1="0"
                y2="0"
                stroke="var(--ink)"
                strokeWidth="2"
                strokeLinecap="round"
                transform={`rotate(${limitAngle})`}
              >
                <title>{`Budget limit ${money(limit!)}`}</title>
              </line>
            )}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className={`${centre.length > 9 ? "text-xl" : "text-2xl"} max-w-[130px] font-bold leading-tight`}>{centre}</div>
          {sub && <div className="text-sm text-muted">{sub}</div>}
        </div>
      </div>
      <figcaption className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SPENT }} /> Spent {money(spent, true)}
        </span>
        {current && toCome > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TO_COME }} /> Still to come {money(toCome, true)}
          </span>
        )}
        {limit != null && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-ink" /> Limit {money(limit, true)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * Cumulative spend through the period, against a straight-line pace to the
 * limit, with the forecast continuing to the period end.
 */
export function PaceChart({
  daily,
  daysInPeriod,
  limit,
  forecast,
  current,
}: {
  daily: { date: string; spent: number }[];
  daysInPeriod: number;
  limit: number | null;
  forecast: number;
  current: boolean;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 320;
  const H = 170;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const n = Math.max(daysInPeriod, daily.length, 2);
  const last = daily.at(-1)?.spent ?? 0;
  const max = Math.max(limit ?? 0, forecast, last, 1) * 1.08;
  const x = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.spent).toFixed(1)}`).join(" ");
  const lastI = daily.length - 1;
  const point = hi != null ? daily[hi] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHi(Math.max(0, Math.min(lastI, i)));
  }

  return (
    <figure>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none"
          role="img"
          aria-label={`Spent ${money(last)} so far${limit ? ` against a ${money(limit)} pace` : ""}; forecast ${money(forecast)}`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHi(null)}
        >
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border)" />
          {limit != null && (
            <>
              <line x1={x(0)} y1={y(0)} x2={x(n - 1)} y2={y(limit)} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 4" />
              <text x={W - pad.r} y={y(limit) - 5} textAnchor="end" fontSize="10" fill="var(--muted)">Pace to {money(limit, true)}</text>
            </>
          )}
          {current && lastI < n - 1 && (
            <line x1={x(lastI)} y1={y(last)} x2={x(n - 1)} y2={y(forecast)} stroke={TO_COME} strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />
          )}
          <path d={path} fill="none" stroke={SPENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {lastI >= 0 && <circle cx={x(lastI)} cy={y(last)} r="4" fill={SPENT} stroke="var(--surface-solid)" strokeWidth="2" />}
          {point && (
            <>
              <line x1={x(hi!)} x2={x(hi!)} y1={pad.t} y2={y(0)} stroke="var(--muted)" strokeWidth="1" />
              <circle cx={x(hi!)} cy={y(point.spent)} r="4.5" fill={SPENT} stroke="var(--surface-solid)" strokeWidth="2" />
            </>
          )}
          <text x={pad.l} y={H - 6} fontSize="10" fill="var(--muted)">{daily[0] ? shortDate(daily[0].date) : ""}</text>
          <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="10" fill="var(--muted)">day {n}</text>
        </svg>
        {point && (
          <div className="pointer-events-none absolute top-0 rounded-xl border border-border bg-surface-solid px-2 py-1 text-xs shadow" style={{ left: `${Math.min(70, (x(hi!) / W) * 100)}%` }}>
            <div className="text-muted">{shortDate(point.date)}</div>
            <div className="font-semibold">{money(point.spent)} spent</div>
          </div>
        )}
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: SPENT }} /> Spent so far</span>
        {current && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dotted" style={{ borderColor: TO_COME }} /> Forecast {money(forecast, true)}</span>}
        {limit != null && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-muted" /> Even pace</span>}
      </figcaption>
    </figure>
  );
}

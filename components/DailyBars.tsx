"use client";

import { useState } from "react";
import { money, shortDate } from "@/lib/client";

/** Single-series daily spend bars with a tap/hover readout. */
export default function DailyBars({ data }: { data: { date: string; spent: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const bottom = 16;
  const top = 16;
  const max = Math.max(1, ...data.map((d) => d.spent));
  const slot = W / Math.max(1, data.length);
  const barW = Math.max(2, slot - 2);
  const y = (v: number) => top + (H - top - bottom) * (1 - Math.max(0, v) / max);
  const shown = active ?? data.reduce((best, d, i) => (d.spent > data[best].spent ? i : best), 0);
  const d = data[shown];
  return (
    <figure>
      <figcaption className="text-xs text-muted" aria-live="polite">
        {d ? `${shortDate(d.date)}: ${money(d.spent)}` : ""}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Spending per day">
        <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--border)" />
        {data.map((p, i) => {
          const yt = y(p.spent);
          const h = Math.max(0, H - bottom - yt);
          return (
            <g key={p.date}>
              <rect x={i * slot + 1} y={yt} width={barW} height={h} rx={Math.min(2, h)} fill="var(--bar)" opacity={i === shown ? 1 : 0.5} />
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}>
                <title>{`${shortDate(p.date)}: ${money(p.spent)}`}</title>
              </rect>
            </g>
          );
        })}
        {data.length > 0 && (
          <>
            <text x={0} y={H - 3} fontSize={9} fill="var(--muted)">{shortDate(data[0].date)}</text>
            <text x={W} y={H - 3} fontSize={9} fill="var(--muted)" textAnchor="end">{shortDate(data[data.length - 1].date)}</text>
          </>
        )}
      </svg>
    </figure>
  );
}

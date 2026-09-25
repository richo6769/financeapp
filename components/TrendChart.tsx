"use client";

import { useState } from "react";
import { money } from "@/lib/client";

type Point = { month: string; label: string; spent: number };

/** Single-series monthly spend bars. Hover/tap a bar for its exact value. */
export default function TrendChart({ data, cap }: { data: Point[]; cap: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 320;
  const H = 150;
  const top = 18;
  const bottom = 22;
  const max = Math.max(1, cap ?? 0, ...data.map((d) => d.spent)) * 1.1;
  const slot = W / data.length;
  const barW = Math.min(34, slot * 0.55);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const shown = active ?? data.length - 1;
  const r = 4;

  return (
    <figure>
      <figcaption className="sr-only">Monthly spending, last 6 months</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly spending bar chart">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={y(max * f / 1.1)} y2={y(max * f / 1.1)} stroke="var(--border)" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--border)" strokeWidth={1} />
        {cap != null && (
          <g>
            <line x1={0} x2={W} y1={y(cap)} y2={y(cap)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} />
            <text x={W - 2} y={y(cap) - 4} textAnchor="end" fontSize={9} fill="var(--muted)">cap {money(cap, true)}</text>
          </g>
        )}
        {data.map((d, i) => {
          const x = i * slot + (slot - barW) / 2;
          const yTop = y(Math.max(0, d.spent));
          const h = Math.max(0, H - bottom - yTop);
          const rr = Math.min(r, h);
          const path = `M${x},${H - bottom} V${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} H${x + barW - rr} Q${x + barW},${yTop} ${x + barW},${yTop + rr} V${H - bottom} Z`;
          return (
            <g key={d.month}>
              <path d={path} fill="var(--bar)" opacity={i === shown ? 1 : 0.45} />
              <text x={x + barW / 2} y={H - 7} textAnchor="middle" fontSize={10} fill="var(--muted)">{d.label}</text>
              {/* generous hit target */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(i)}
              >
                <title>{`${d.label}: ${money(d.spent)}`}</title>
              </rect>
            </g>
          );
        })}
        <text
          x={Math.min(W - 30, Math.max(30, shown * slot + slot / 2))}
          y={y(Math.max(0, data[shown]?.spent ?? 0)) - 5}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill="var(--ink)"
        >
          {money(data[shown]?.spent ?? 0, true)}
        </text>
      </svg>
    </figure>
  );
}

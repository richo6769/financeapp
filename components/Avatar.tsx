"use client";

import { useState } from "react";

const PALETTE = ["#c9673f", "#3b82f6", "#16a34a", "#a855f7", "#e11d48", "#0891b2", "#d97706", "#64748b"];

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

function colourFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Merchant logo (from Akahu) in a circle, or coloured initials when there isn't one. */
export default function Avatar({ name, logo, size = 44, dim = false }: { name: string; logo?: string | null; size?: number; dim?: boolean }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full bg-white object-contain p-1 ${dim ? "opacity-50" : ""}`}
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${dim ? "opacity-50" : ""}`}
      style={{ ...style, background: colourFor(name) }}
    >
      {initials(name)}
    </span>
  );
}

/** Small round category icon with the category's colour behind it. */
export function CatDot({ icon, color, size = 22 }: { icon: string; color?: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, fontSize: size * 0.55, background: `color-mix(in srgb, ${color ?? "#9ca3af"} 32%, transparent)` }}
    >
      {icon}
    </span>
  );
}

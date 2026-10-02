"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";
const KEY = "ledger:theme";

/** Appearance: dark (default), light, or follow the phone. Stored in this browser only. */
export default function ThemePicker() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    try {
      const t = localStorage.getItem(KEY);
      if (t === "light" || t === "system") setTheme(t);
    } catch {
      /* storage unavailable */
    }
  }, []);
  function pick(t: Theme) {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  }
  return (
    <section className="card space-y-2">
      <h2 className="font-semibold">Appearance</h2>
      <div className="seg" role="tablist" aria-label="Appearance">
        {(["dark", "light", "system"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={theme === t} onClick={() => pick(t)}>
            {t === "dark" ? "🌙 Dark" : t === "light" ? "☀️ Light" : "📱 Phone"}
          </button>
        ))}
      </div>
    </section>
  );
}

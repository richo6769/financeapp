"use client";

import type { Cat } from "./types";

/** Grouped <select> of categories (subcategories indented under parents). */
export default function CategorySelect({
  cats,
  value,
  onChange,
  includeUncategorised = true,
  className = "",
  ariaLabel = "Category",
}: {
  cats: Cat[];
  value: string | null;
  onChange: (id: string | null) => void;
  includeUncategorised?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select
      aria-label={ariaLabel}
      className={`input py-1 text-sm ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {includeUncategorised && <option value="">Uncategorised</option>}
      {roots.map((r) => [
        <option key={r.id} value={r.id}>{r.name}</option>,
        ...cats
          .filter((c) => c.parent_id === r.id)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {"   "}↳ {s.name}
            </option>
          )),
      ])}
    </select>
  );
}

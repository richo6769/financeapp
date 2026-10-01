import Link from "next/link";
import { money } from "@/lib/client";

export default function BudgetBar({
  name,
  spent,
  budget,
  color,
  paceFraction,
  href,
}: {
  name: string;
  spent: number;
  budget: number | null;
  color?: string | null;
  paceFraction: number;
  /** Makes the row tappable, e.g. to see what makes up the spend. */
  href?: string;
}) {
  const over = budget != null && spent > budget;
  const pct = budget ? Math.min(100, Math.max(0, (spent / budget) * 100)) : 0;
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color ?? "var(--muted)" }} aria-hidden />
          {name}
        </span>
        <span className={over ? "font-semibold text-danger" : "text-muted"}>
          {spent < 0 ? <span title="Refunds exceeded purchases this period">−{money(-spent, true)} refunds</span> : money(spent, true)}
          {budget != null && <> / {money(budget, true)}</>}
          {over && <span className="ml-1">▲ over</span>}
          {href && <span className="ml-1 text-muted" aria-hidden>›</span>}
        </span>
      </div>
      {budget != null && (
        <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${name} budget used`}>
          <div className={`h-full rounded-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
          {/* expected-by-today marker */}
          <div className="absolute top-0 h-full w-0.5 bg-ink/40" style={{ left: `${paceFraction * 100}%` }} aria-hidden />
        </div>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="-mx-2 block rounded-lg px-2 py-2 hover:bg-surface-2 active:bg-surface-2">
      {body}
    </Link>
  ) : (
    <div className="py-2">{body}</div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import SyncButton from "./SyncButton";
import { signOut } from "@/app/login/actions";

type Status = { supabase: boolean; akahu: "mock" | "live"; claude: boolean };

const NAV = [
  { href: "/", label: "Home", icon: "M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z" },
  { href: "/transactions", label: "Activity", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/inbox", label: "Inbox", icon: "M3 13l3-8h12l3 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1zm0 0h5l1 3h6l1-3h5" },
  { href: "/chat", label: "Chat", icon: "M4 5h16v11H8l-4 4z" },
  { href: "/budgets", label: "Budgets", icon: "M12 3v18M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H6" },
];

export default function AppShell({ status, children }: { status: Status; children: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  if (path.startsWith("/login")) return <>{children}</>;

  const badges = [
    !status.supabase && "Demo data store",
    status.akahu === "mock" && "Mock bank data",
    !status.claude && "Offline chat",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto min-h-dvh max-w-3xl pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-2">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Kiwi Ledger
          </Link>
          <div className="flex items-center gap-2">
            <SyncButton />
            {status.supabase && (
              <form action={signOut}>
                <button className="btn" aria-label="Sign out" title="Sign out">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a1 1 0 011 1v16a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3" /></svg>
                </button>
              </form>
            )}
          </div>
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-2">
            {badges.map((b) => (
              <span key={b} className="chip">{b}</span>
            ))}
          </div>
        )}
      </header>
      <main className="px-4 py-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] ${active ? "text-accent" : "text-muted"}`}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={n.icon} />
                  </svg>
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

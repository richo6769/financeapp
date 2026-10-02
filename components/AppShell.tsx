"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import SyncButton from "./SyncButton";
import { signOut } from "@/app/login/actions";

type Status = { supabase: boolean; akahu: "mock" | "live"; claude: boolean };

const NAV = [
  { href: "/", label: "Home", icon: "M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z", match: (p: string) => p === "/" },
  {
    href: "/transactions",
    label: "Activity",
    icon: "M5 4h14a1 1 0 011 1v15l-3-2-3 2-3-2-3 2-3-2V5a1 1 0 011-1zM8 9h8M8 13h6",
    match: (p: string) => p.startsWith("/transactions"),
  },
  {
    href: "/budget",
    label: "Budget",
    icon: "M12 3a9 9 0 109 9h-9zM14 3.2A9 9 0 0120.8 10H14z",
    match: (p: string) => ["/budget", "/insights", "/spending"].some((x) => p.startsWith(x)),
  },
  {
    href: "/inbox",
    label: "Inbox",
    icon: "M3 13l3-8h12l3 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1zm0 0h5l1 3h6l1-3h5",
    match: (p: string) => p.startsWith("/inbox"),
  },
  {
    href: "/more",
    label: "More",
    icon: "M5 12h.01M12 12h.01M19 12h.01",
    match: (p: string) => ["/more", "/rules", "/owed", "/trips", "/subscriptions", "/recaps", "/settings"].some((x) => p.startsWith(x)),
  },
];

const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export default function AppShell({ status, children }: { status: Status; children: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  if (path.startsWith("/login")) return <>{children}</>;

  const badges = [
    !status.supabase && "Demo data",
    status.akahu === "mock" && "Mock bank",
    !status.claude && "Offline chat",
  ].filter(Boolean) as string[];
  const onChat = path.startsWith("/chat");

  return (
    <div className="mx-auto min-h-dvh max-w-3xl pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <header className="px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-ink" aria-hidden>
              K
            </span>
            <span className="truncate text-lg font-semibold tracking-tight">Kiwi Ledger</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/transactions?search=1" className="icon-btn" aria-label="Search transactions">
              <Icon d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-3.5-3.5" size={18} />
            </Link>
            <SyncButton />
            {status.supabase && (
              <form action={signOut}>
                <button className="icon-btn" aria-label="Sign out" title="Sign out">
                  <Icon d="M15 3h4a1 1 0 011 1v16a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3" size={18} />
                </button>
              </form>
            )}
          </div>
        </div>
        {badges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {badges.map((b) => (
              <span key={b} className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-ink">
                {b}
              </span>
            ))}
          </div>
        )}
      </header>

      <main className="px-4 py-4">{children}</main>

      {/* Floating pill nav + a separate AI (chat) button. */}
      <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <nav
            aria-label="Main"
            className="flex min-w-0 flex-1 items-center justify-between rounded-full border border-border bg-[var(--nav)] p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          >
            {NAV.map((n) => {
              const active = n.match(path);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-12 items-center justify-center gap-1.5 rounded-full transition-all ${
                    active ? "flex-[2] bg-surface-2 px-3 font-semibold text-ink" : "flex-1 text-muted"
                  }`}
                >
                  <Icon d={n.icon} />
                  <span className={active ? "text-sm" : "sr-only"}>{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <Link
            href="/chat"
            aria-label="Ask the AI assistant"
            aria-current={onChat ? "page" : undefined}
            className={`flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-full border border-border shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl ${
              onChat ? "bg-accent text-accent-ink" : "bg-[var(--nav)] text-accent"
            }`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M10 3l1.6 4.9L16.5 9.5l-4.9 1.6L10 16l-1.6-4.9L3.5 9.5l4.9-1.6zM18 13l.9 2.6 2.6.9-2.6.9L18 20l-.9-2.6-2.6-.9 2.6-.9z" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

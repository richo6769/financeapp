import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { integrationStatus } from "@/lib/env";

export const metadata: Metadata = {
  title: "Kiwi Ledger",
  description: "Personal finance tracker (NZD)",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Kiwi Ledger", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const status = integrationStatus();
  return (
    <html lang="en-NZ">
      <body>
        <AppShell status={status}>{children}</AppShell>
      </body>
    </html>
  );
}

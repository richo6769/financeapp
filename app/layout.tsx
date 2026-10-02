import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { integrationStatus } from "@/lib/env";

export const metadata: Metadata = {
  title: "Kiwi Ledger",
  description: "Personal finance tracker (NZD)",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Kiwi Ledger", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16191f",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const status = integrationStatus();
  return (
    <html lang="en-NZ" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved appearance before first paint (dark unless you chose otherwise in Settings). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("ledger:theme");if(t==="light"||t==="system")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>
        <AppShell status={status}>{children}</AppShell>
      </body>
    </html>
  );
}

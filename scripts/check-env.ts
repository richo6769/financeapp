/**
 * Prints which integrations are live vs mock with your current env.
 *   npm run check-env            (reads .env.local via Next's loader)
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { integrationStatus, env } = await import("@/lib/env");
const s = integrationStatus();
const line = (ok: boolean, label: string, detail: string) => console.log(`${ok ? "✅" : "⚪"} ${label.padEnd(10)} ${detail}`);

line(s.supabase, "Supabase", s.supabase ? "configured (login + Postgres)" : "not set → local JSON demo store, no login");
line(Boolean(env.supabaseServiceRoleKey), "Service", env.supabaseServiceRoleKey ? "service-role key set (cron can run)" : "SUPABASE_SERVICE_ROLE_KEY missing → cron sync will fail");
line(Boolean(env.ownerEmail), "Owner", env.ownerEmail ? `sign-in restricted to ${env.ownerEmail}` : "OWNER_EMAIL missing → required once Supabase is configured");
line(s.akahu === "live", "Akahu", s.akahu === "live" ? "LIVE bank data" : env.akahuAppToken && env.akahuUserToken ? "tokens set but mock (AKAHU_MODE=mock or Supabase missing)" : "mock data (tokens missing)");
line(s.claude, "Claude", s.claude ? `live (${env.claudeModel})` : "offline pattern-matcher (ANTHROPIC_API_KEY missing)");
line(Boolean(env.cronSecret), "Cron", env.cronSecret ? "CRON_SECRET set" : "CRON_SECRET missing → /api/cron/sync rejects all calls");

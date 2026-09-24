import "server-only";

/**
 * Central env checks. Every external integration is optional so the app
 * builds and runs with zero keys:
 *  - No Supabase  -> local JSON store in .data/ (demo mode, no login)
 *  - No Akahu     -> mock ANZ + Amex data
 *  - No Anthropic -> offline rule-based chat planner that calls the same tools
 */

const v = (k: string) => {
  const val = process.env[k];
  return val && val.trim() !== "" ? val.trim() : undefined;
};

export const env = {
  supabaseUrl: v("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: v("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: v("SUPABASE_SERVICE_ROLE_KEY"),
  ownerEmail: v("OWNER_EMAIL")?.toLowerCase(),
  akahuAppToken: v("AKAHU_APP_TOKEN"),
  akahuUserToken: v("AKAHU_USER_TOKEN"),
  akahuMode: (v("AKAHU_MODE") ?? "auto") as "auto" | "mock" | "live",
  anthropicKey: v("ANTHROPIC_API_KEY"),
  claudeModel: v("CLAUDE_MODEL") ?? "claude-sonnet-5",
  cronSecret: v("CRON_SECRET"),
  dataDir: v("LOCAL_DATA_DIR"),
};

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export function isClaudeConfigured(): boolean {
  return Boolean(env.anthropicKey);
}

/**
 * Live Akahu requires both tokens AND Supabase (so real bank data is always
 * behind a login). AKAHU_MODE=mock forces mock even when tokens are set.
 */
export function akahuMode(): "mock" | "live" {
  if (env.akahuMode === "mock") return "mock";
  const hasTokens = Boolean(env.akahuAppToken && env.akahuUserToken);
  if (!hasTokens) return "mock";
  if (!isSupabaseConfigured()) {
    console.warn(
      "[akahu] Tokens present but Supabase is not configured; staying in mock mode so real bank data is never served without login.",
    );
    return "mock";
  }
  return "live";
}

export function integrationStatus() {
  return {
    supabase: isSupabaseConfigured(),
    akahu: akahuMode(),
    claude: isClaudeConfigured(),
  };
}

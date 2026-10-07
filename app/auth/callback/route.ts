import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createUserClient } from "@/lib/supabase/server";
import { env, isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Magic-link landing: exchanges the code (PKCE) or token_hash for a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = new URL("/", url.origin);
  if (!isSupabaseConfigured()) return NextResponse.redirect(home);
  const supabase = await createUserClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "magiclink") as EmailOtpType;
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing code") };
  if (error) {
    // The PKCE verifier lives in the browser that asked for the link; opening
    // the link in another browser (e.g. the Mail/Gmail in-app one) can't finish it.
    const message = /code verifier|pkce/i.test(error.message)
      ? "That link opened in a different browser from the one you asked from. Enter the 6-digit code from the email instead, or request a new link and open it in the same browser."
      : /expired|invalid/i.test(error.message)
        ? "That link has expired or was already used. Request a new code."
        : error.message;
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, url.origin));
  }
  const { data } = await supabase.auth.getUser();
  if (!env.ownerEmail || data.user?.email?.toLowerCase() !== env.ownerEmail) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("This account isn't allowed")}`, url.origin));
  }
  return NextResponse.redirect(home);
}

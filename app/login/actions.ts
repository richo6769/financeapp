"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env, isSupabaseConfigured } from "@/lib/env";
import { createUserClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured()) redirect("/");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid email address." };
  // Single-user app: only the owner may sign in. Respond identically either way.
  const generic = { ok: true, message: "If that email is allowed, a sign-in link is on its way. Check your inbox." };
  if (!env.ownerEmail) return { ok: false, message: "Server is missing OWNER_EMAIL." };
  if (email !== env.ownerEmail) return generic;
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: true },
  });
  if (error) return { ok: false, message: error.message };
  return generic;
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createUserClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

import "server-only";
import { env, isSupabaseConfigured } from "@/lib/env";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";
import { LocalStore } from "./local";
import { SupabaseStore } from "./supabase";
import type { Store } from "./types";
import { ensureSeeded } from "@/lib/seed";

export type { Store } from "./types";

export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
  }
}

let localSingleton: LocalStore | null = null;

/** Store for the current request's user. Throws UnauthorizedError if not signed in. */
export async function getStore(): Promise<Store> {
  if (!isSupabaseConfigured()) {
    localSingleton ??= new LocalStore(DEMO_USER_ID);
    await ensureSeeded(localSingleton);
    return localSingleton;
  }
  const sb = await createUserClient();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) throw new UnauthorizedError();
  // Single-user app: OWNER_EMAIL is mandatory once Supabase is on.
  if (!env.ownerEmail) throw new Error("Set OWNER_EMAIL to your email address to use Supabase mode.");
  if (user.email?.toLowerCase() !== env.ownerEmail) throw new UnauthorizedError();
  const store = new SupabaseStore(sb, user.id);
  await ensureSeeded(store);
  return store;
}

/** Store for background jobs (cron). Resolves the single owner via OWNER_EMAIL. */
export async function getOwnerStore(): Promise<Store> {
  if (!isSupabaseConfigured()) {
    localSingleton ??= new LocalStore(DEMO_USER_ID);
    await ensureSeeded(localSingleton);
    return localSingleton;
  }
  const sb = createServiceClient();
  if (!env.ownerEmail) throw new Error("OWNER_EMAIL must be set for cron sync");
  let userId: string | undefined;
  for (let page = 1; page < 20 && !userId; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Supabase listUsers: ${error.message}`);
    userId = data.users.find((u) => u.email?.toLowerCase() === env.ownerEmail)?.id;
    if (data.users.length < 100) break;
  }
  if (!userId) throw new Error(`No Supabase user for OWNER_EMAIL (${env.ownerEmail}). Log in once first.`);
  const store = new SupabaseStore(sb, userId);
  await ensureSeeded(store);
  return store;
}

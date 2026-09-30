import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isSupabaseConfigured()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[80dvh] max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Kiwi Ledger</h1>
      <p className="mt-1 text-sm text-muted">Sign in with a magic link.</p>
      {error && <p className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      <LoginForm />
    </main>
  );
}

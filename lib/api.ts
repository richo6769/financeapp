import "server-only";
import { NextResponse } from "next/server";
import { getStore, UnauthorizedError, type Store } from "@/lib/store";
import { UserError } from "@/lib/services";

/** Wrap a route handler: resolve the user's store and map errors to JSON. */
export async function withStore(fn: (store: Store) => Promise<unknown>): Promise<NextResponse> {
  try {
    const store = await getStore();
    const data = await fn(store);
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new UserError("Invalid JSON body");
  }
}

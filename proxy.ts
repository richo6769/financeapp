import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = ["/login", "/auth/callback", "/api/cron/", "/manifest.webmanifest", "/sw.js", "/icons/", "/offline"];

/**
 * Refreshes the Supabase session cookie and gates every page behind login.
 * With no Supabase env vars the app runs in local demo mode and this is a no-op.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Single-user app: a session for any other email is treated as signed out.
  // (Routes enforce this again server-side via getStore.)
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const allowed = Boolean(user && owner && user.email?.toLowerCase() === owner);
  if (user && !allowed && !path.startsWith("/login") && !path.startsWith("/auth/")) {
    await supabase.auth.signOut();
    if (path.startsWith("/api/")) return NextResponse.json({ error: "This account isn't allowed" }, { status: 403 });
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "?error=This%20account%20isn%27t%20allowed";
    const res = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }
  if (!allowed && !PUBLIC.some((p) => path.startsWith(p))) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp)$).*)"],
};

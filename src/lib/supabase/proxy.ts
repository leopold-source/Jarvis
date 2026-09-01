import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";

/** Chemins accessibles sans session. */
const PUBLIC_PATHS = ["/connexion", "/auth", "/mot-de-passe"];

/**
 * Rafraîchit la session à chaque navigation et aiguille l'utilisateur vers
 * l'espace correspondant à son rôle : `/portail` pour un client, le CRM sinon.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.searchParams.set("suite", pathname);
    return NextResponse.redirect(url);
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const isClient = profile?.role === "client";
    const inPortal = pathname.startsWith("/portail");

    // Un client n'a rien à faire dans le CRM, et inversement.
    if (isClient && !inPortal && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/portail";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (!isClient && inPortal) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/connexion")) {
      const url = request.nextUrl.clone();
      url.pathname = isClient ? "/portail" : "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

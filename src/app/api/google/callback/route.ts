import { NextResponse, type NextRequest } from "next/server";

import { getProfile } from "@/lib/auth";
import { exchangeCode, fetchGoogleEmail, googleRedirectUri } from "@/lib/google";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Retour de Google.
 *
 * Le jeton de rafraîchissement est écrit avec la clé service_role : la colonne
 * est fermée au rôle `authenticated`, précisément pour qu'elle ne puisse jamais
 * repartir vers un navigateur.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const settings = (reason: string) => NextResponse.redirect(`${origin}/parametres?google=${reason}`);

  const profile = await getProfile();
  if (!profile || profile.role === "client") return NextResponse.redirect(`${origin}/connexion`);

  if (url.searchParams.get("error")) return settings("refus");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.cookies.get("google_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) return settings("etat");

  const admin = createAdminClient();
  if (!admin) return settings("service");

  try {
    const tokens = await exchangeCode(code, googleRedirectUri(origin));
    if (!tokens.refresh_token) return settings("sans-refresh");

    const email = await fetchGoogleEmail(tokens.access_token);

    const { error } = await admin.from("google_accounts").upsert(
      {
        user_id: profile.id,
        email,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        connected_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "user_id" },
    );
    if (error) return settings("base");
  } catch {
    return settings("echec");
  }

  const response = settings("ok");
  response.cookies.delete("google_oauth_state");
  return response;
}

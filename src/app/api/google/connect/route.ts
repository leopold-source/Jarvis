import { NextResponse, type NextRequest } from "next/server";

import { getProfile } from "@/lib/auth";
import { googleAuthorizeUrl, googleCredentials, googleRedirectUri } from "@/lib/google";

/**
 * Départ du parcours OAuth.
 *
 * L'état anti-CSRF est tiré au sort ici et déposé dans un cookie httpOnly : au
 * retour, Google nous le rend et on vérifie qu'il s'agit bien du même. Sans
 * cela, n'importe qui pourrait faire aboutir un consentement sur ce compte.
 */
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  const origin = new URL(request.url).origin;

  if (!profile || profile.role === "client") {
    return NextResponse.redirect(`${origin}/connexion`);
  }
  if (!googleCredentials()) {
    return NextResponse.redirect(`${origin}/parametres?google=config`);
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(googleAuthorizeUrl(googleRedirectUri(origin), state));

  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}

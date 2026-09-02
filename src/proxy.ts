import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Tout sauf les fichiers statiques, les images, et les points d'entrée
     * appelés par des machines.
     *
     * `api/claap` et `api/cron` s'authentifient eux-mêmes — signature HMAC
     * pour l'un, jeton porteur pour l'autre — et n'ont aucune session à
     * rafraîchir. Les laisser passer ici les envoyait vers `/connexion` :
     * l'appelant recevait une redirection qu'il interprétait comme un succès,
     * et la route n'était jamais exécutée.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/claap|api/cron|api/pennylane|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

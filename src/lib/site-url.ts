/**
 * L'adresse publique de l'application, pour les liens qu'on envoie par e-mail.
 *
 * Une invitation était construite sur `window.location.origin` : l'adresse du
 * navigateur au moment du clic. Depuis la production c'est juste, depuis un
 * poste de développement c'est `http://localhost:3000`, et le destinataire
 * reçoit un lien qui ne mène nulle part chez lui. Le tort n'est pas dans la
 * valeur, il est dans la source — l'origine de celui qui invite ne dit rien de
 * l'adresse où l'invité doit se rendre.
 *
 * L'ordre de préférence règle cela une fois pour toutes : la valeur qu'on a
 * posée à la main, puis le domaine de production que Vercel expose lui-même,
 * et seulement à défaut l'origine courante. En développement, on retombe donc
 * sur localhost, ce qui est exactement ce qu'on veut là-bas.
 */
export function siteUrl(origineCourante?: string): string {
  const explicite = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicite) return sansBarreFinale(explicite);

  // Vercel expose le domaine de production même depuis une préproduction : un
  // lien d'invitation envoyé depuis une branche mène ainsi au vrai site.
  const vercel = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${sansBarreFinale(vercel).replace(/^https?:\/\//, "")}`;

  if (origineCourante) return sansBarreFinale(origineCourante);
  if (typeof window !== "undefined") return sansBarreFinale(window.location.origin);

  return "";
}

function sansBarreFinale(valeur: string): string {
  return valeur.replace(/\/+$/, "");
}

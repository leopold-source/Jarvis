import Anthropic from "@anthropic-ai/sdk";

/**
 * Accès centralisé à la clé Anthropic.
 *
 * La clé est lue à l'exécution, jamais au build : sur Vercel elle appartient au
 * déploiement en cours, donc un déploiement antérieur — ou une URL figée sur un
 * ancien build — ne la verra pas. Elle est aussi coupée aux extrémités, car un
 * copier-coller y laisse souvent un retour à la ligne qui casse l'en-tête HTTP
 * sans qu'aucun message ne l'explique.
 */
export function anthropicKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Espace de travail à facturer.
 *
 * Les clés « identity-linked » (créées comme personnelles, portée « tous les
 * espaces de travail ») n'ont pas d'espace de travail implicite : l'API les
 * rejette en 400 tant qu'on ne lui dit pas au nom de quel espace on appelle.
 * Une clé créée directement dans un espace de travail n'a pas besoin de ceci.
 */
export function anthropicWorkspaceId(): string | null {
  const id = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return id ? id : null;
}

export const MISSING_KEY_ERROR =
  "Clé ANTHROPIC_API_KEY absente du déploiement en cours. Ouvrez /diagnostic pour voir quelle version tourne et ce qui manque.";

/** Client SDK avec la clé nettoyée. Suppose `anthropicKey()` déjà vérifiée. */
export function anthropicClient(): Anthropic {
  const workspaceId = anthropicWorkspaceId();
  return new Anthropic({
    apiKey: anthropicKey() ?? undefined,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
}

/** Traduit une erreur SDK en message lisible, en distinguant les cas courants. */
export function describeAnthropicError(caught: unknown): string {
  if (caught instanceof Anthropic.APIError) {
    if (caught.status === 401) {
      return "Clé ANTHROPIC_API_KEY refusée (401) : elle est présente mais invalide, révoquée ou tronquée.";
    }
    if (/anthropic-workspace-id/i.test(caught.message)) {
      return (
        "La clé est valide mais rattachée à une identité, pas à un espace de travail : " +
        "l'API exige alors de préciser l'espace à facturer. Deux issues — créer une clé " +
        "de type « Espace de travail » dans la console, ou renseigner ANTHROPIC_WORKSPACE_ID."
      );
    }
    if (caught.status === 400 && /credit/i.test(caught.message)) {
      return "Crédits Anthropic épuisés : rechargez le solde de l'organisation.";
    }
    if (caught.status === 429) {
      return "Limite de débit atteinte (429) : réessayez dans un instant.";
    }
    return `Erreur API (${caught.status}) : ${caught.message}`;
  }
  return caught instanceof Error ? caught.message : "Appel au modèle impossible.";
}

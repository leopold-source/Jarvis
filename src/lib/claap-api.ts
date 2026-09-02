/**
 * Client REST Claap.
 *
 * La documentation de Claap n'est pas joignable depuis l'environnement où ce
 * code a été écrit : plutôt que de deviner la forme de l'API et d'expédier du
 * code non vérifié, on essaie plusieurs conventions courantes et on retient
 * celle qui répond. `probeClaap` sert à constater laquelle fonctionne ; une
 * fois connue, on peut figer l'appel.
 */

const BASES = ["https://api.claap.io/v1", "https://api.claap.io"];

/** Schémas d'authentification rencontrés chez la plupart des fournisseurs. */
function authVariants(key: string): Array<[string, Record<string, string>]> {
  return [
    ["Bearer", { Authorization: `Bearer ${key}` }],
    ["X-API-Key", { "X-API-Key": key }],
    ["X-Claap-Api-Key", { "X-Claap-Api-Key": key }],
  ];
}

export type ProbeResult = {
  url: string;
  auth: string;
  status: number;
  ok: boolean;
  /** Début de la réponse, pour lire la forme sans tout ramener. */
  preview: string;
};

/**
 * Essaie les combinaisons base × authentification sur un point d'entrée en
 * lecture seule, et renvoie ce que chacune a répondu.
 */
export async function probeClaap(key: string, path = "/recordings"): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const base of BASES) {
    for (const [name, headers] of authVariants(key)) {
      const url = `${base}${path}?limit=1`;
      try {
        const response = await fetch(url, { headers: { ...headers, Accept: "application/json" } });
        const text = await response.text();
        results.push({
          url,
          auth: name,
          status: response.status,
          ok: response.ok,
          preview: text.slice(0, 300),
        });
        // Une réponse correcte suffit : inutile de continuer à taper l'API.
        if (response.ok) return results;
      } catch (caught) {
        results.push({
          url,
          auth: name,
          status: 0,
          ok: false,
          preview: caught instanceof Error ? caught.message : "échec réseau",
        });
      }
    }
  }

  return results;
}

export function claapKey(): string | null {
  const key = process.env.CLAAP_API_KEY?.trim();
  return key ? key : null;
}

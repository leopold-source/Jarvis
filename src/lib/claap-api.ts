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
    ["X-Claap-Key", { "X-Claap-Key": key }],
    ["Bearer", { Authorization: `Bearer ${key}` }],
    ["X-API-Key", { "X-API-Key": key }],
    ["X-Claap-Api-Key", { "X-Claap-Api-Key": key }],
  ];
}

/*
  La combinaison qui a répondu, gardée le temps que vit l'instance.

  Sans elle, chaque appel referait la tournée des huit essais — et taperait
  sept fois l'API en erreur pour une réponse utile. Une fois trouvée, on s'y
  tient ; un refus la fait oublier, au cas où Claap aurait changé.
*/
let retenue: { base: string; headers: Record<string, string> } | null = null;

export type ClaapReponse = { ok: true; data: unknown } | { ok: false; detail: string };

/** Un GET sur l'API Claap, avec la première combinaison qui répond. */
export async function claapGet(path: string): Promise<ClaapReponse> {
  const key = claapKey();
  if (!key) return { ok: false, detail: "CLAAP_API_KEY absente." };

  const essais = retenue
    ? [retenue]
    : BASES.flatMap((base) => authVariants(key).map(([, headers]) => ({ base, headers })));

  let dernier = "aucune réponse";
  for (const essai of essais) {
    try {
      const reponse = await fetch(`${essai.base}${path}`, {
        headers: { ...essai.headers, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (reponse.ok) {
        retenue = essai;
        return { ok: true, data: await reponse.json() };
      }
      dernier = `${reponse.status} sur ${essai.base}${path}`;
      if (retenue) retenue = null;
    } catch (caught) {
      dernier = caught instanceof Error ? caught.message : "échec réseau";
    }
  }
  return { ok: false, detail: `API Claap injoignable (${dernier}).` };
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

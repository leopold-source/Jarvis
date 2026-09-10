import { REGIONS } from "@/lib/constants";

/**
 * La région, déduite du code postal.
 *
 * Un export de prospection donne l'adresse du siège et presque jamais la
 * région. La déduire est un calcul, pas une interprétation : le département
 * détermine la région sans ambiguïté. Autant le faire ici — gratuitement, sur
 * toutes les lignes — plutôt que de le demander à un modèle qui coûte, met du
 * temps et peut se tromper.
 */

type Region = (typeof REGIONS)[number];

const DEPARTEMENTS: Record<Region, string[]> = {
  "Auvergne-Rhône-Alpes": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
  "Bourgogne-Franche-Comté": ["21", "25", "39", "58", "70", "71", "89", "90"],
  Bretagne: ["22", "29", "35", "56"],
  "Centre-Val de Loire": ["18", "28", "36", "37", "41", "45"],
  Corse: ["20"],
  "Grand Est": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
  "Hauts-de-France": ["02", "59", "60", "62", "80"],
  "Île-de-France": ["75", "77", "78", "91", "92", "93", "94", "95"],
  Normandie: ["14", "27", "50", "61", "76"],
  "Nouvelle-Aquitaine": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
  Occitanie: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
  "Pays de la Loire": ["44", "49", "53", "72", "85"],
  "Provence-Alpes-Côte d'Azur": ["04", "05", "06", "13", "83", "84"],
  "Outre-mer": ["97", "98"],
};

const BY_DEPARTEMENT = new Map<string, Region>();
for (const [region, codes] of Object.entries(DEPARTEMENTS) as Array<[Region, string[]]>) {
  for (const code of codes) BY_DEPARTEMENT.set(code, region);
}

/** Le code postal français : cinq chiffres, isolés dans une adresse libre. */
export function postalCodeFrom(address: string | null | undefined): string | null {
  if (!address) return null;
  // Ancré sur une frontière de mot pour ne pas confondre avec un SIRET ou un
  // numéro de voie collé à un autre nombre.
  const match = address.match(/(?<!\d)(\d{5})(?!\d)/);
  return match ? match[1] : null;
}

export function regionFromPostalCode(code: string | null | undefined): Region | null {
  if (!code || code.length < 2) return null;
  return BY_DEPARTEMENT.get(code.slice(0, 2)) ?? null;
}

export function regionFromAddress(address: string | null | undefined): Region | null {
  return regionFromPostalCode(postalCodeFrom(address));
}

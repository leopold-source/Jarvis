/**
 * Les échéances du jour, et celles qu'il faut voir venir.
 *
 * « Demain » veut dire le prochain jour travaillé : le vendredi, on anticipe
 * le lundi — une relance posée pour lundi matin se prépare le vendredi, pas
 * le dimanche soir. Toutes les dates sont des jours `AAAA-MM-JJ` parisiens.
 */

function decaler(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = dimanche … 6 = samedi. */
function jourDeSemaine(jour: string): number {
  return new Date(`${jour}T12:00:00Z`).getUTCDay();
}

export function estOuvre(jour: string): boolean {
  const j = jourDeSemaine(jour);
  return j !== 0 && j !== 6;
}

export function prochainOuvre(jour: string): string {
  let suivant = decaler(jour, 1);
  while (!estOuvre(suivant)) suivant = decaler(suivant, 1);
  return suivant;
}

/** La veille travaillée : le lundi, c'est vendredi. */
export function precedentOuvre(jour: string): string {
  let avant = decaler(jour, -1);
  while (!estOuvre(avant)) avant = decaler(avant, -1);
  return avant;
}

export type Echeance = "retard" | "jour" | "prochain";

/**
 * Où tombe une échéance : en retard, aujourd'hui, ou d'ici le prochain jour
 * travaillé. Au-delà, rien — elle n'appelle pas encore d'attention.
 */
export function classerEcheance(le: string | null | undefined, aujourdhui: string): Echeance | null {
  if (!le) return null;
  const jour = le.slice(0, 10);
  if (jour < aujourdhui) return "retard";
  if (jour === aujourdhui) return "jour";
  if (jour <= prochainOuvre(aujourdhui)) return "prochain";
  return null;
}

/** « lundi », « demain » : le nom du prochain jour travaillé. */
export function nomProchainOuvre(aujourdhui: string): string {
  const suivant = prochainOuvre(aujourdhui);
  if (suivant === decaler(aujourdhui, 1)) return "Demain";
  const nom = new Date(`${suivant}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
  return nom.charAt(0).toUpperCase() + nom.slice(1);
}

/** Nombre de jours de retard d'une échéance passée. */
export function joursDeRetard(le: string, aujourdhui: string): number {
  return Math.round((Date.parse(`${aujourdhui}T12:00:00Z`) - Date.parse(`${le.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

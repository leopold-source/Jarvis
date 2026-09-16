/**
 * Ce qu'une fiche de lead laisse modifier, et comment on en tire un patch.
 *
 * Extrait du composant parce que c'est ici qu'une erreur ne se verrait pas :
 * une clé mal recopiée relierait deux colonnes, un champ vide écraserait une
 * valeur par une chaîne vide au lieu d'un `null`, un effectif collé depuis un
 * export deviendrait `NaN`. Le rendu, lui, se voit à l'œil nu.
 */
import type { Lead, LeadModifiable } from "@/lib/database.types";

/** Un champ libre de la fiche, décrit plutôt que répété en JSX. */
export type Champ = {
  cle: keyof LeadModifiable;
  label: string;
  type?: "text" | "email" | "tel" | "url" | "number";
  hint?: string;
  /** Prend la ligne entière : une adresse ou une URL ne tient pas en demi-colonne. */
  large?: boolean;
  /** Nombre de lignes, pour les champs qui méritent un pavé. */
  lignes?: number;
  placeholder?: string;
};

/*
  Vingt-cinq champs, déclarés une fois.

  Écrits à la main, ils feraient quatre cents lignes de JSX où une faute de
  frappe dans un `value` relierait deux colonnes sans que rien ne le signale.
  Déclarés, ils se lisent d'un coup d'œil, et la clé qui les relie à la base
  est vérifiée par le compilateur.
*/
export const SECTIONS: Array<{ titre: string; champs: Champ[] }> = [
  {
    titre: "Qualification",
    champs: [
      { cle: "segment", label: "Segment", placeholder: "Ingénierie, industrie…" },
      {
        cle: "source",
        label: "Source",
        hint: "D'où vient cette fiche : import, LinkedIn, recommandation…",
      },
    ],
  },
  {
    titre: "La personne",
    champs: [
      { cle: "first_name", label: "Prénom" },
      { cle: "last_name", label: "Nom" },
      {
        cle: "full_name",
        label: "Nom affiché",
        large: true,
        hint: "Ce que montrent la liste, le titre de cette fiche et les rappels.",
      },
      { cle: "job_title", label: "Poste", large: true },
      { cle: "email", label: "E-mail", type: "email", large: true },
      {
        cle: "email_quality",
        label: "Fiabilité de l'e-mail",
        hint: "Ce qu'en dit la source : une adresse douteuse ne se brûle qu'une fois.",
      },
      { cle: "linkedin_url", label: "LinkedIn", type: "url" },
      { cle: "phone", label: "Téléphone", type: "tel" },
      { cle: "phone_standard", label: "Standard", type: "tel", hint: "La ligne de l'accueil." },
    ],
  },
  {
    titre: "L'entreprise",
    champs: [
      { cle: "company_name", label: "Nom commercial" },
      {
        cle: "company_legal_name",
        label: "Raison sociale",
        hint: "Celle qui devra figurer sur un devis.",
      },
      { cle: "company_website", label: "Site web", type: "url" },
      { cle: "company_linkedin_url", label: "LinkedIn entreprise", type: "url" },
      { cle: "company_activity", label: "Activité" },
      { cle: "sector", label: "Secteur" },
      { cle: "siren", label: "SIREN" },
      {
        cle: "siret",
        label: "SIRET",
        hint: "Il créera la fiche client chez Pennylane le jour où l'affaire se gagne.",
      },
      { cle: "headcount", label: "Effectif", type: "number" },
      { cle: "headcount_range", label: "Tranche d'effectif", placeholder: "50 - 200" },
      { cle: "revenue", label: "Chiffre d'affaires (€)", type: "number" },
      { cle: "revenue_year", label: "Année du CA", type: "number", placeholder: "2025" },
      { cle: "founded_year", label: "Année de création", type: "number" },
      { cle: "region", label: "Région" },
      { cle: "address", label: "Adresse", large: true },
      { cle: "company_description", label: "Description", large: true, lignes: 3 },
    ],
  },
];

/** Les champs libres, à plat — pour parcourir sans imbriquer deux boucles. */
export const CHAMPS = SECTIONS.flatMap((section) => section.champs);

/** La valeur d'une colonne, telle qu'un champ de saisie la porte. */
export function texteDe(fiche: Lead, cle: keyof LeadModifiable): string {
  const brut = fiche[cle];
  return brut === null || brut === undefined ? "" : String(brut);
}

/**
 * Le nom affiché, quand il n'a pas divergé du prénom et du nom.
 *
 * `full_name` est une colonne à part, pas un calcul de la base : corriger une
 * coquille dans le nom laissait la liste, les rappels et le titre de la fiche
 * sur l'ancienne orthographe, sans rien dire. Il suit donc la somme des deux
 * tant qu'il en est exactement la somme — et cesse de suivre dès qu'on lui a
 * donné autre chose, ce qui est le cas de toutes les fiches importées où seul
 * le nom complet est renseigné.
 *
 * Rend `null` quand il n'y a rien à propager.
 */
export function nomAffiche(
  avant: { first_name?: string; last_name?: string; full_name?: string },
  apres: { first_name?: string; last_name?: string },
): string | null {
  const somme = (valeurs: { first_name?: string; last_name?: string }) =>
    `${valeurs.first_name ?? ""} ${valeurs.last_name ?? ""}`.trim();

  if ((avant.full_name ?? "").trim() !== somme(avant)) return null;
  return somme(apres);
}

/**
 * Ce qui a bougé entre la fiche en base et le formulaire — et rien d'autre.
 *
 * Un différentiel, pas un remplacement : envoyer la fiche entière à chaque
 * enregistrement écraserait la modification qu'un autre onglet vient de faire
 * sur un champ qu'on n'a pas touché. Ce qui n'est pas mentionné ne peut pas
 * être écrasé.
 *
 * Le vide devient `null` et non `""` : une colonne vidée doit redevenir vide
 * au sens de la base, sans quoi les filtres « renseigné » compteraient des
 * chaînes de longueur zéro.
 */
export function patchFiche(
  fiche: Lead,
  brouillon: Record<string, string>,
): { patch: Partial<LeadModifiable> } | { erreur: string } {
  const patch: Record<string, unknown> = {};

  for (const champ of CHAMPS) {
    const saisi = (brouillon[champ.cle] ?? "").trim();
    let apres: string | number | null = saisi === "" ? null : saisi;

    if (champ.type === "number" && saisi !== "") {
      // Les effectifs et les chiffres d'affaires arrivent collés d'un export :
      // « 1 250 » et « 1250,5 » sont des nombres, et le dire ici évite de
      // renvoyer l'utilisateur à sa mise en forme.
      const nombre = Number(saisi.replace(",", ".").replace(/\s/g, ""));
      if (!Number.isFinite(nombre)) return { erreur: `« ${champ.label} » n'est pas un nombre.` };
      apres = nombre;
    }

    const avant = fiche[champ.cle] ?? null;
    if (apres !== avant) patch[champ.cle] = apres;
  }

  return { patch: patch as Partial<LeadModifiable> };
}

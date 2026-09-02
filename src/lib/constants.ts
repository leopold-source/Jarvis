import type {
  DealStage,
  DocumentKind,
  LeadStatus,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "@/lib/database.types";

/**
 * Libellés et couleurs des énumérations métier.
 *
 * Chaque statut a sa propre teinte : on doit pouvoir lire un tableau en
 * diagonale et repérer une ligne à sa couleur, sans lire le texte. Les gris
 * sont réservés aux fins de course (non qualifié, clôturé).
 *
 * `tone` est la clé de style partagée — badges, colonnes du Kanban, pastilles,
 * barres de progression — pour qu'une même notion garde partout la même couleur.
 */
export type Tone =
  | "stone"
  | "red"
  | "orange"
  | "amber"
  | "lime"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "indigo"
  | "violet"
  | "fuchsia"
  | "pink"
  | "rose";

/** Badge discret : fond teinté, texte lisible sur les deux thèmes. */
export const TONE_CLASSES: Record<Tone, string> = {
  stone: "bg-stone-500/14 text-stone-600 ring-stone-500/25 dark:text-stone-300 dark:ring-stone-400/25",
  red: "bg-red-500/14 text-red-700 ring-red-500/25 dark:text-red-300 dark:ring-red-400/30",
  orange: "bg-orange-500/14 text-orange-700 ring-orange-500/25 dark:text-orange-300 dark:ring-orange-400/30",
  amber: "bg-amber-500/16 text-amber-700 ring-amber-500/25 dark:text-amber-300 dark:ring-amber-400/30",
  lime: "bg-lime-500/16 text-lime-700 ring-lime-500/25 dark:text-lime-300 dark:ring-lime-400/30",
  emerald: "bg-emerald-500/14 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300 dark:ring-emerald-400/30",
  teal: "bg-teal-500/14 text-teal-700 ring-teal-500/25 dark:text-teal-300 dark:ring-teal-400/30",
  cyan: "bg-cyan-500/14 text-cyan-700 ring-cyan-500/25 dark:text-cyan-300 dark:ring-cyan-400/30",
  sky: "bg-sky-500/14 text-sky-700 ring-sky-500/25 dark:text-sky-300 dark:ring-sky-400/30",
  indigo: "bg-indigo-500/14 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300 dark:ring-indigo-400/30",
  violet: "bg-violet-500/14 text-violet-700 ring-violet-500/25 dark:text-violet-300 dark:ring-violet-400/30",
  fuchsia: "bg-fuchsia-500/14 text-fuchsia-700 ring-fuchsia-500/25 dark:text-fuchsia-300 dark:ring-fuchsia-400/30",
  pink: "bg-pink-500/14 text-pink-700 ring-pink-500/25 dark:text-pink-300 dark:ring-pink-400/30",
  rose: "bg-rose-500/14 text-rose-700 ring-rose-500/25 dark:text-rose-300 dark:ring-rose-400/30",
};

/** Pastille pleine : repère de couleur dans une liste ou un en-tête. */
export const TONE_DOT: Record<Tone, string> = {
  stone: "bg-stone-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  lime: "bg-lime-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  cyan: "bg-cyan-500",
  sky: "bg-sky-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  fuchsia: "bg-fuchsia-500",
  pink: "bg-pink-500",
  rose: "bg-rose-500",
};

/** Dégradé, pour les barres de répartition et de progression. */
export const TONE_GRADIENT: Record<Tone, string> = {
  stone: "from-stone-500 to-stone-400",
  red: "from-red-500 to-red-400",
  orange: "from-orange-500 to-orange-400",
  amber: "from-amber-500 to-amber-400",
  lime: "from-lime-500 to-lime-400",
  emerald: "from-emerald-500 to-emerald-400",
  teal: "from-teal-500 to-teal-400",
  cyan: "from-cyan-500 to-cyan-400",
  sky: "from-sky-500 to-sky-400",
  indigo: "from-indigo-500 to-indigo-400",
  violet: "from-violet-500 to-violet-400",
  fuchsia: "from-fuchsia-500 to-fuchsia-400",
  pink: "from-pink-500 to-pink-400",
  rose: "from-rose-500 to-rose-400",
};

// --- Leads ----------------------------------------------------------------
// La série NRP se réchauffe à chaque tentative (ambre → orange → rouge), les
// refus virent au rose, et « call pris » est le seul vert de la table.
export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  nouveau: { label: "Nouveau", tone: "sky" },
  a_contacter: { label: "À contacter", tone: "cyan" },
  nrp: { label: "NRP", tone: "amber" },
  nrp2: { label: "NRP 2", tone: "orange" },
  nrp3: { label: "NRP 3", tone: "red" },
  a_recontacter: { label: "À recontacter", tone: "violet" },
  raccroche_avant_pitch: { label: "Raccroché avant pitch", tone: "rose" },
  pas_interesse: { label: "Pas intéressé", tone: "pink" },
  non_qualifie: { label: "Non qualifié", tone: "stone" },
  call_pris: { label: "Call pris", tone: "emerald" },
};

export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "nouveau",
  "a_contacter",
  "nrp",
  "nrp2",
  "nrp3",
  "a_recontacter",
  "raccroche_avant_pitch",
  "pas_interesse",
  "non_qualifie",
  "call_pris",
];

export const CALL_KIND: Record<string, { label: string; tone: Tone }> = {
  r1: { label: "R1", tone: "indigo" },
  r2: { label: "R2", tone: "violet" },
  decouverte: { label: "Découverte", tone: "sky" },
  demo: { label: "Démo", tone: "cyan" },
  closing: { label: "Closing", tone: "emerald" },
  suivi: { label: "Suivi", tone: "teal" },
  interne: { label: "Interne", tone: "stone" },
  non_qualifie: { label: "Non qualifié", tone: "stone" },
};

export const CALL_KIND_ORDER = [
  "r1", "r2", "decouverte", "demo", "closing", "suivi", "interne", "non_qualifie",
] as const;

// --- Affaires -------------------------------------------------------------
export const DEAL_STAGE: Record<
  DealStage,
  { label: string; short: string; tone: Tone; probability: number }
> = {
  demande_rdv_envoyee: { label: "Demande de RDV envoyée", short: "Demande RDV", tone: "sky", probability: 10 },
  r1: { label: "R1", short: "R1", tone: "indigo", probability: 30 },
  r2: { label: "R2", short: "R2", tone: "violet", probability: 50 },
  propale_envoyee: { label: "Propale envoyée", short: "Propale", tone: "fuchsia", probability: 70 },
  no_show: { label: "No show", short: "No show", tone: "amber", probability: 10 },
  nurturing: { label: "Nurturing", short: "Nurturing", tone: "teal", probability: 15 },
  gagne: { label: "Gagné", short: "Gagné", tone: "emerald", probability: 100 },
  perdu: { label: "Perdu", short: "Perdu", tone: "red", probability: 0 },
  non_qualifie: { label: "Non qualifié", short: "Non qualifié", tone: "stone", probability: 0 },
};

/** Ordre des colonnes du Kanban, du premier contact à la clôture. */
export const DEAL_STAGE_ORDER: DealStage[] = [
  "demande_rdv_envoyee",
  "r1",
  "r2",
  "propale_envoyee",
  "no_show",
  "nurturing",
  "gagne",
  "perdu",
  "non_qualifie",
];

/** Étapes encore en cours : servent au calcul du pipeline pondéré. */
export const OPEN_STAGES: DealStage[] = [
  "demande_rdv_envoyee",
  "r1",
  "r2",
  "propale_envoyee",
  "no_show",
  "nurturing",
];

// --- Projets --------------------------------------------------------------
export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone }> = {
  cadrage: { label: "Cadrage", tone: "sky" },
  en_cours: { label: "En cours", tone: "violet" },
  en_pause: { label: "En pause", tone: "amber" },
  livre: { label: "Livré", tone: "emerald" },
  cloture: { label: "Clôturé", tone: "stone" },
};

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  "cadrage",
  "en_cours",
  "en_pause",
  "livre",
  "cloture",
];

export const PROJECT_HEALTH: Record<string, { label: string; tone: Tone }> = {
  vert: { label: "Sous contrôle", tone: "emerald" },
  orange: { label: "Vigilance", tone: "amber" },
  rouge: { label: "En risque", tone: "red" },
};

// --- Tâches ---------------------------------------------------------------
export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  a_faire: { label: "À faire", tone: "stone" },
  en_cours: { label: "En cours", tone: "violet" },
  en_revue: { label: "En revue", tone: "fuchsia" },
  termine: { label: "Terminé", tone: "emerald" },
  bloque: { label: "Bloqué", tone: "red" },
};

export const TASK_STATUS_ORDER: TaskStatus[] = [
  "a_faire",
  "en_cours",
  "en_revue",
  "bloque",
  "termine",
];

export const TASK_PRIORITY: Record<TaskPriority, { label: string; tone: Tone }> = {
  basse: { label: "Basse", tone: "stone" },
  normale: { label: "Normale", tone: "sky" },
  haute: { label: "Haute", tone: "orange" },
  critique: { label: "Critique", tone: "red" },
};

export const DOCUMENT_KIND: Record<DocumentKind, { label: string; tone: Tone }> = {
  devis: { label: "Devis", tone: "sky" },
  contrat: { label: "Contrat", tone: "violet" },
  livrable: { label: "Livrable", tone: "emerald" },
  brief: { label: "Brief", tone: "teal" },
  facture: { label: "Facture", tone: "amber" },
  autre: { label: "Autre", tone: "stone" },
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "Administrateur",
  member: "Collaborateur",
  client: "Client",
};

/** Squelette de projet appliqué à la création depuis une affaire gagnée. */
export const PROJECT_TEMPLATE: Array<{
  title: string;
  kind: "jalon" | "production";
  offsetDays: number;
  clientVisible?: boolean;
}> = [
  { title: "Kick-off client", kind: "jalon", offsetDays: 7, clientVisible: true },
  { title: "Collecte des informations et accès", kind: "production", offsetDays: 10 },
  { title: "Cadrage validé", kind: "jalon", offsetDays: 21, clientVisible: true },
  { title: "Conception de la solution", kind: "production", offsetDays: 35 },
  { title: "Développement / mise en œuvre", kind: "production", offsetDays: 60 },
  { title: "Recette interne", kind: "production", offsetDays: 70 },
  { title: "Livraison et recette client", kind: "jalon", offsetDays: 80, clientVisible: true },
  { title: "Formation des équipes", kind: "production", offsetDays: 85 },
  { title: "Clôture du projet", kind: "jalon", offsetDays: 90, clientVisible: true },
];

/** Régions françaises, pour normaliser l'import et alimenter les filtres. */
export const REGIONS = [
  "Auvergne-Rhône-Alpes",
  "Bourgogne-Franche-Comté",
  "Bretagne",
  "Centre-Val de Loire",
  "Corse",
  "Grand Est",
  "Hauts-de-France",
  "Île-de-France",
  "Normandie",
  "Nouvelle-Aquitaine",
  "Occitanie",
  "Pays de la Loire",
  "Provence-Alpes-Côte d'Azur",
  "Outre-mer",
] as const;

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
 * `tone` sert de clé de style partagée (badges, colonnes du Kanban, points de
 * statut) pour que la même notion ait toujours la même couleur dans l'app.
 */
export type Tone = "slate" | "indigo" | "violet" | "cyan" | "emerald" | "amber" | "rose" | "sky";

export const TONE_CLASSES: Record<Tone, string> = {
  slate: "bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-300 dark:ring-slate-400/25",
  indigo: "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300 dark:ring-indigo-400/30",
  violet: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300 dark:ring-violet-400/30",
  cyan: "bg-cyan-500/12 text-cyan-700 ring-cyan-500/25 dark:text-cyan-300 dark:ring-cyan-400/30",
  sky: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300 dark:ring-sky-400/30",
  emerald: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300 dark:ring-emerald-400/30",
  amber: "bg-amber-500/14 text-amber-700 ring-amber-500/25 dark:text-amber-300 dark:ring-amber-400/30",
  rose: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300 dark:ring-rose-400/30",
};

/** Variante lisible sur fond clair, utilisée par le portail client. */
export const TONE_DOT: Record<Tone, string> = {
  slate: "bg-slate-400",
  indigo: "bg-indigo-400",
  violet: "bg-violet-400",
  cyan: "bg-cyan-400",
  sky: "bg-sky-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
};

// --- Leads ----------------------------------------------------------------
export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  nouveau: { label: "Nouveau", tone: "slate" },
  a_contacter: { label: "À contacter", tone: "sky" },
  nrp: { label: "NRP", tone: "slate" },
  nrp2: { label: "NRP 2", tone: "slate" },
  nrp3: { label: "NRP 3", tone: "slate" },
  raccroche_avant_pitch: { label: "Raccroché avant pitch", tone: "rose" },
  a_recontacter: { label: "À recontacter", tone: "amber" },
  pas_interesse: { label: "Pas intéressé", tone: "rose" },
  non_qualifie: { label: "Non qualifié", tone: "slate" },
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

// --- Affaires -------------------------------------------------------------
export const DEAL_STAGE: Record<
  DealStage,
  { label: string; short: string; tone: Tone; probability: number }
> = {
  demande_rdv_envoyee: { label: "Demande de RDV envoyée", short: "Demande RDV", tone: "sky", probability: 10 },
  r1: { label: "R1", short: "R1", tone: "indigo", probability: 30 },
  r2: { label: "R2", short: "R2", tone: "violet", probability: 50 },
  propale_envoyee: { label: "Propale envoyée", short: "Propale", tone: "cyan", probability: 70 },
  no_show: { label: "No show", short: "No show", tone: "amber", probability: 10 },
  nurturing: { label: "Nurturing", short: "Nurturing", tone: "slate", probability: 15 },
  gagne: { label: "Gagné", short: "Gagné", tone: "emerald", probability: 100 },
  perdu: { label: "Perdu", short: "Perdu", tone: "rose", probability: 0 },
  non_qualifie: { label: "Non qualifié", short: "Non qualifié", tone: "slate", probability: 0 },
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
  en_cours: { label: "En cours", tone: "indigo" },
  en_pause: { label: "En pause", tone: "amber" },
  livre: { label: "Livré", tone: "emerald" },
  cloture: { label: "Clôturé", tone: "slate" },
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
  rouge: { label: "En risque", tone: "rose" },
};

// --- Tâches ---------------------------------------------------------------
export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  a_faire: { label: "À faire", tone: "slate" },
  en_cours: { label: "En cours", tone: "indigo" },
  en_revue: { label: "En revue", tone: "violet" },
  termine: { label: "Terminé", tone: "emerald" },
  bloque: { label: "Bloqué", tone: "rose" },
};

export const TASK_STATUS_ORDER: TaskStatus[] = [
  "a_faire",
  "en_cours",
  "en_revue",
  "bloque",
  "termine",
];

export const TASK_PRIORITY: Record<TaskPriority, { label: string; tone: Tone }> = {
  basse: { label: "Basse", tone: "slate" },
  normale: { label: "Normale", tone: "sky" },
  haute: { label: "Haute", tone: "amber" },
  critique: { label: "Critique", tone: "rose" },
};

export const DOCUMENT_KIND: Record<DocumentKind, { label: string; tone: Tone }> = {
  devis: { label: "Devis", tone: "sky" },
  contrat: { label: "Contrat", tone: "violet" },
  livrable: { label: "Livrable", tone: "emerald" },
  brief: { label: "Brief", tone: "indigo" },
  facture: { label: "Facture", tone: "amber" },
  autre: { label: "Autre", tone: "slate" },
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

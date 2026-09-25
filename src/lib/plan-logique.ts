/**
 * Le plan du jour commercial : une seule liste, une ligne par affaire ou par
 * lead, classée par importance.
 *
 * C'est la source de vérité de la journée. Elle se calcule à chaque lecture à
 * partir du CRM — rien n'est figé le matin — et tout ce qui la faisait
 * autrefois en trois endroits (prochaines actions, à réveiller, ce qui tombe)
 * s'y retrouve fondu : une affaire qui cumule une étape en retard et un devis
 * expiré n'apparaît qu'une fois, avec sa raison la plus forte en titre et les
 * autres en dessous.
 *
 * Trois paliers, dans cet ordre : les affaires, puis les leads à relancer,
 * puis — seulement quand les deux premiers sont vides — la prospection libre.
 */
import type { DealStage } from "@/lib/database.types";
import { joursDeRetard, prochainOuvre } from "@/lib/echeances";

export type Niveau = "urgent" | "jour" | "avancer";

export type TypeRaison =
  | "recap"
  | "no_show"
  | "etape_retard"
  | "devis_expire"
  | "etape_jour"
  | "devis_echeance"
  | "sans_suite"
  | "dormante";

export type AffaireEntree = {
  id: string;
  nom: string;
  etape: DealStage;
  etapeLibelle: string;
  montant: number | null;
  ownerId: string | null;
  nextStep: string | null;
  nextStepOn: string | null;
  dormante: boolean;
  joursDansEtape: number | null;
};

export type DevisEntree = { dealId: string; numero: string | null; statut: string; echeanceLe: string | null };
export type LeadEntree = {
  id: string;
  nom: string;
  entreprise: string | null;
  statutLibelle: string;
  followUpOn: string;
  ownerId: string | null;
  nrp: number;
};

export type ItemAffaire = {
  cle: string;
  dealId: string;
  nom: string;
  etape: DealStage;
  etapeLibelle: string;
  montant: number | null;
  ownerId: string | null;
  niveau: Niveau;
  type: TypeRaison;
  /** Ce qu'il y a à faire, en une ligne. */
  action: string;
  /** La raison principale, en bref (« sans nouvelle depuis 34 j »). */
  motif: string;
  /** Les autres raisons pour lesquelles l'affaire est là, en bref. */
  aussi: string[];
  retard: number;
  score: number;
};

export type ItemLead = {
  cle: string;
  leadId: string;
  nom: string;
  entreprise: string | null;
  statutLibelle: string;
  le: string;
  retard: number;
  ownerId: string | null;
};

export type Plan = {
  aujourdhui: string;
  prochain: string;
  affaires: ItemAffaire[];
  relances: ItemLead[];
  /** Affaires dont l'étape tombe le prochain jour ouvré : annoncées, pas encore dues. */
  aVenir: number;
  /** Ce qui a déjà été coché aujourd'hui. */
  faits: number;
};

const FERMEES: DealStage[] = ["gagne", "perdu", "non_qualifie"];
const CHAUDES: DealStage[] = ["r1", "r2", "propale_envoyee"];

/** Plus l'affaire est avancée, plus son geste compte. */
const POIDS_ETAPE: Partial<Record<DealStage, number>> = {
  propale_envoyee: 8,
  r2: 6,
  r1: 4,
  no_show: 3,
  demande_rdv_envoyee: 1,
};

const NIVEAU: Record<TypeRaison, Niveau> = {
  recap: "urgent",
  no_show: "urgent",
  etape_retard: "urgent",
  devis_expire: "urgent",
  etape_jour: "jour",
  devis_echeance: "jour",
  sans_suite: "avancer",
  dormante: "avancer",
};

const BASE: Record<TypeRaison, number> = {
  recap: 90,
  no_show: 85,
  etape_retard: 80,
  devis_expire: 75,
  etape_jour: 60,
  devis_echeance: 55,
  sans_suite: 40,
  dormante: 35,
};

type Raison = { type: TypeRaison; action: string; bref: string; retard: number };

function raisonsDe(a: AffaireEntree, devis: DevisEntree[], recapPret: boolean, aujourdhui: string, prochain: string): Raison[] {
  const r: Raison[] = [];
  if (recapPret) r.push({ type: "recap", action: "Relire et envoyer le récap R2", bref: "récap R2 prêt", retard: 0 });
  if (a.etape === "no_show") {
    r.push({ type: "no_show", action: "Replanifier le rendez-vous manqué", bref: "no-show", retard: 0 });
  }
  if (a.nextStepOn && a.nextStepOn < aujourdhui) {
    const retard = joursDeRetard(a.nextStepOn, aujourdhui);
    r.push({
      type: "etape_retard",
      action: a.nextStep?.trim() || "Prochaine étape à préciser",
      bref: `étape en retard de ${retard} j`,
      retard,
    });
  } else if (a.nextStepOn === aujourdhui) {
    r.push({ type: "etape_jour", action: a.nextStep?.trim() || "Prochaine étape à préciser", bref: "étape du jour", retard: 0 });
  }
  for (const d of devis) {
    const num = d.numero ? ` ${d.numero}` : "";
    if (d.statut === "expire" || (d.statut === "en_attente" && d.echeanceLe && d.echeanceLe < aujourdhui)) {
      r.push({ type: "devis_expire", action: `Relancer le devis${num} (expiré)`, bref: `devis${num} expiré`, retard: 0 });
    } else if (d.statut === "en_attente" && d.echeanceLe && d.echeanceLe <= prochain) {
      r.push({ type: "devis_echeance", action: `Relancer le devis${num} avant son échéance`, bref: `devis${num} expire bientôt`, retard: 0 });
    }
  }
  // Sans prochaine étape datée : l'affaire n'a pas de suite, ou dort.
  if (!a.nextStepOn) {
    if (a.dormante) {
      r.push({
        type: "dormante",
        action: "Réveiller l'affaire : relancer ou trancher",
        bref: a.joursDansEtape != null ? `sans nouvelle depuis ${a.joursDansEtape} j` : "en sommeil",
        retard: 0,
      });
    } else if (CHAUDES.includes(a.etape)) {
      r.push({ type: "sans_suite", action: "Fixer la prochaine étape", bref: "aucune étape datée", retard: 0 });
    }
  }
  return r;
}

function score(raison: Raison, a: AffaireEntree): number {
  return (
    BASE[raison.type] +
    Math.min(raison.retard, 20) +
    (POIDS_ETAPE[a.etape] ?? 0) +
    Math.min((a.montant ?? 0) / 2000, 6) +
    (raison.type === "dormante" ? Math.min((a.joursDansEtape ?? 0) / 10, 8) : 0)
  );
}

export function construirePlan(entree: {
  aujourdhui: string;
  affaires: AffaireEntree[];
  devis: DevisEntree[];
  recapsPrets: string[];
  leads: LeadEntree[];
  coches: Set<string>;
}): Plan {
  const { aujourdhui } = entree;
  const prochain = prochainOuvre(aujourdhui);
  const devisParAffaire = new Map<string, DevisEntree[]>();
  for (const d of entree.devis) devisParAffaire.set(d.dealId, [...(devisParAffaire.get(d.dealId) ?? []), d]);
  const recaps = new Set(entree.recapsPrets);

  let faits = 0;
  let aVenir = 0;
  const affaires: ItemAffaire[] = [];

  for (const a of entree.affaires) {
    if (FERMEES.includes(a.etape)) continue;
    const raisons = raisonsDe(a, devisParAffaire.get(a.id) ?? [], recaps.has(a.id), aujourdhui, prochain);
    if (!raisons.length) {
      if (a.nextStepOn && a.nextStepOn > aujourdhui && a.nextStepOn <= prochain) aVenir += 1;
      continue;
    }
    const cle = `deal:${a.id}`;
    if (entree.coches.has(cle)) {
      faits += 1;
      continue;
    }
    const classees = raisons.map((r) => ({ r, s: score(r, a) })).sort((x, y) => y.s - x.s);
    const principale = classees[0]!;
    affaires.push({
      cle,
      dealId: a.id,
      nom: a.nom,
      etape: a.etape,
      etapeLibelle: a.etapeLibelle,
      montant: a.montant,
      ownerId: a.ownerId,
      niveau: NIVEAU[principale.r.type],
      type: principale.r.type,
      action: principale.r.action,
      motif: principale.r.bref,
      aussi: classees.slice(1).map((c) => c.r.bref),
      retard: principale.r.retard,
      score: Math.round(principale.s * 10) / 10,
    });
  }
  affaires.sort((x, y) => y.score - x.score || x.nom.localeCompare(y.nom));

  const relances: ItemLead[] = [];
  for (const l of entree.leads) {
    if (l.followUpOn > aujourdhui) continue;
    const cle = `lead:${l.id}`;
    if (entree.coches.has(cle)) {
      faits += 1;
      continue;
    }
    relances.push({
      cle,
      leadId: l.id,
      nom: l.nom,
      entreprise: l.entreprise,
      statutLibelle: l.statutLibelle,
      le: l.followUpOn,
      retard: joursDeRetard(l.followUpOn, aujourdhui),
      ownerId: l.ownerId,
    });
  }
  // Les plus en retard d'abord : ce sont elles qui refroidissent.
  relances.sort((x, y) => y.retard - x.retard || x.nom.localeCompare(y.nom));

  return { aujourdhui, prochain, affaires, relances, aVenir, faits };
}

/** Le plan d'une personne : ses affaires (et celles sans responsable), ses leads. */
export function planDe(plan: Plan, userId: string): Plan {
  return {
    ...plan,
    affaires: plan.affaires.filter((a) => a.ownerId === userId || a.ownerId === null),
    relances: plan.relances.filter((l) => l.ownerId === userId),
  };
}

/** La prospection libre s'ouvre quand les affaires et les relances sont faites. */
export function verrouProspection(plan: Plan): { ouvert: boolean; affaires: number; relances: number } {
  return { ouvert: plan.affaires.length === 0 && plan.relances.length === 0, affaires: plan.affaires.length, relances: plan.relances.length };
}

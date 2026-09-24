/**
 * Lire un devis Pennylane, et décider de ce qu'il change à l'affaire.
 *
 * La documentation de Pennylane n'est pas joignable depuis l'environnement où
 * ce code a été écrit : les champs sont donc lus sous plusieurs graphies, et
 * les statuts sous leurs noms anglais comme français. Le corps brut est gardé
 * en base pour qu'un champ manqué se rattrape sans resynchroniser.
 */
import type { DealStage } from "@/lib/database.types";

export type StatutDevis = "brouillon" | "en_attente" | "accepte" | "refuse" | "facture" | "expire" | "inconnu";

const STATUTS: Array<[RegExp, StatutDevis]> = [
  [/^(draft|brouillon)$/i, "brouillon"],
  [/^(pending|sent|waiting|awaiting|upcoming|en[_ ]attente|envoy)/i, "en_attente"],
  [/^(accepted|signed|approved|accept|sign)/i, "accepte"],
  [/^(denied|refused|rejected|declined|refus)/i, "refuse"],
  [/^(invoiced|factur|billed)/i, "facture"],
  [/^(expired|expir|late)/i, "expire"],
];

export function statutDevis(brut: unknown): StatutDevis {
  if (typeof brut !== "string") return "inconnu";
  return STATUTS.find(([motif]) => motif.test(brut.trim()))?.[1] ?? "inconnu";
}

export type DevisLu = {
  pennylaneId: string;
  numero: string | null;
  statut: StatutDevis;
  statutBrut: string | null;
  montantHt: number | null;
  emisLe: string | null;
  echeanceLe: string | null;
  clientId: string | null;
  clientNom: string | null;
  url: string | null;
};

type Objet = Record<string, unknown>;

function champ(o: Objet, ...chemins: string[]): unknown {
  for (const chemin of chemins) {
    const valeur = chemin.split(".").reduce<unknown>(
      (acc, part) => (acc && typeof acc === "object" ? (acc as Objet)[part] : undefined),
      o,
    );
    if (valeur !== undefined && valeur !== null && valeur !== "") return valeur;
  }
  return null;
}

function texte(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function nombre(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function jour(v: unknown): string | null {
  const t = texte(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

export function lireDevis(brut: unknown): DevisLu | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Objet;
  const pennylaneId = texte(champ(o, "id", "quote_id"));
  if (!pennylaneId) return null;

  const statutBrut = texte(champ(o, "status", "state", "quote_status"));
  return {
    pennylaneId,
    numero: texte(champ(o, "quote_number", "number", "invoice_number", "label")),
    statut: statutDevis(statutBrut),
    statutBrut,
    montantHt: nombre(
      champ(o, "currency_amount_before_tax", "amount_before_tax", "total_before_tax", "currency_price_before_tax", "amount"),
    ),
    emisLe: jour(champ(o, "date", "issue_date", "issued_on", "created_at")),
    echeanceLe: jour(champ(o, "deadline", "expiry_date", "valid_until", "due_date")),
    clientId: texte(champ(o, "customer.id", "customer_id", "thirdparty.id")),
    clientNom: texte(champ(o, "customer.name", "customer_name", "thirdparty.name")),
    url: texte(champ(o, "public_file_url", "public_url", "file_url", "pdf_url", "url")),
  };
}

/** Les devis d'une page de réponse, où qu'ils soient rangés. */
export function devisDeLaPage(reponse: unknown): unknown[] {
  if (Array.isArray(reponse)) return reponse;
  if (!reponse || typeof reponse !== "object") return [];
  const o = reponse as Objet;
  for (const cle of ["items", "quotes", "data", "results"]) {
    if (Array.isArray(o[cle])) return o[cle] as unknown[];
  }
  return [];
}

/** Le curseur de la page suivante, s'il y en a une. */
export function pageSuivante(reponse: unknown): string | null {
  if (!reponse || typeof reponse !== "object") return null;
  const o = reponse as Objet;
  if (o.has_more === false) return null;
  return texte(champ(o, "next_cursor", "cursor.next", "meta.next_cursor"));
}

/*
  Ce que le statut d'un devis dit de l'affaire.

  Envoyé : l'affaire est en propale, si elle n'y était pas encore. Accepté —
  ou déjà facturé — : elle est gagnée. Un refus ou une expiration ne ferment
  rien d'eux-mêmes : un devis expiré se relance, et un refus se discute ; c'est
  à un associé de décider que l'affaire est perdue.
*/
const AVANT_PROPALE: DealStage[] = ["demande_rdv_envoyee", "r1", "r2", "no_show", "nurturing"];

export function etapeApresDevis(statut: StatutDevis, etape: DealStage): DealStage | null {
  if (statut === "en_attente" && AVANT_PROPALE.includes(etape)) return "propale_envoyee";
  if ((statut === "accepte" || statut === "facture") && etape !== "gagne") return "gagne";
  return null;
}

/**
 * Le statut à garder en base, entre ce qu'on savait et ce que dit Pennylane.
 *
 * Un devis créé depuis l'application naît « pending » chez Pennylane — l'API
 * n'a pas de brouillon — alors qu'il n'est pas encore parti en e-signature. On
 * le tient pour brouillon jusqu'à ce qu'un associé dise l'avoir envoyé, ou que
 * Pennylane rapporte autre chose qu'une attente : signé, refusé, expiré.
 */
export function statutRetenu(avant: StatutDevis | null | undefined, lu: StatutDevis): StatutDevis {
  return avant === "brouillon" && lu === "en_attente" ? "brouillon" : lu;
}

/** Un devis qui attend une relance : expiré, ou toujours en attente passé son échéance. */
export function aRelancer(devis: { statut: string; echeance_le: string | null }, aujourdhui: string): boolean {
  if (devis.statut === "expire") return true;
  return devis.statut === "en_attente" && Boolean(devis.echeance_le && devis.echeance_le < aujourdhui);
}

/**
 * Un nom d'entreprise réduit à ce qui le distingue.
 *
 * « ARCHIMED ENVIRONNEMENT » dans Pennylane, « Archimed Environnement SAS »
 * dans le CRM : sans accents, sans casse, sans forme juridique, les deux
 * deviennent « archimedenvironnement ».
 */
export function nomReduit(nom: string | null | undefined): string {
  return (nom ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(sas|sasu|sarl|eurl|sa|sci|scop|selarl|snc|groupe|group|france)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

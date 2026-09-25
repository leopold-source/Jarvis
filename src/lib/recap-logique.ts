/**
 * Les règles du mail récap, sans base ni réseau.
 *
 * Séparées de ce qui les exécute parce que c'est ici qu'une erreur coûte : un
 * récap tiré du mauvais call, un client oublié en destinataire, une structure
 * qui glisse d'un mail à l'autre. Tout cela se vérifie sans rien envoyer.
 */

import { isInternal, type ClaapParticipant } from "@/lib/claap";

/** Un call tel que le récap en a besoin. */
export type CallPourRecap = {
  id: string;
  started_at: string | null;
  occurred_on: string | null;
  transcript: string | null;
  summary: string | null;
  has_external: boolean;
  participants: unknown;
};

/*
  Douze heures.

  Le passage en R2 suit presque toujours le call de peu : on raccroche, on
  déplace la carte. Un call plus ancien que cela est, le plus souvent, le R1 —
  et rédiger à partir de lui un récap de R2 serait pire que ne rien rédiger.
  Au-delà de cette fenêtre, on attend que le vrai call arrive, et on propose
  l'ancien à la main plutôt que de le choisir en silence.
*/
export const FENETRE_CALL_MS = 12 * 3_600_000;
/** On tolère un call démarré peu après le geste : la carte déplacée pendant le call. */
export const TOLERANCE_APRES_MS = 30 * 60_000;

/** L'instant d'un call : l'heure exacte si Claap l'a donnée, sinon midi du jour. */
export function instantDuCall(call: Pick<CallPourRecap, "started_at" | "occurred_on">): number | null {
  if (call.started_at) {
    const t = Date.parse(call.started_at);
    if (!Number.isNaN(t)) return t;
  }
  if (call.occurred_on) {
    const t = Date.parse(`${call.occurred_on}T12:00:00Z`);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export type ChoixCall =
  | { etat: "pret"; call: CallPourRecap }
  /** Le bon call est là, mais Claap ne l'a pas encore transcrit. */
  | { etat: "en_traitement"; call: CallPourRecap }
  /** Aucun call récent : on attend, en signalant le plus récent qu'on a. */
  | { etat: "attente"; plusRecent: CallPourRecap | null };

/**
 * Le call dont on fait le récap : le plus récent avant le passage en R2.
 *
 * Les réunions internes sont écartées d'office — un point hebdo entre associés
 * n'a pas de destinataire. Parmi les autres, on prend le plus récent qui
 * précède le geste, à condition qu'il tombe dans la fenêtre ; sinon on attend.
 */
export function choisirCall(calls: CallPourRecap[], demandeLe: string): ChoixCall {
  const geste = Date.parse(demandeLe);
  const externes = calls
    .filter((call) => call.has_external)
    .map((call) => ({ call, t: instantDuCall(call) }))
    .filter((x): x is { call: CallPourRecap; t: number } => x.t !== null)
    .filter((x) => x.t <= geste + TOLERANCE_APRES_MS)
    .sort((a, b) => b.t - a.t);

  const premier = externes[0];
  if (!premier) return { etat: "attente", plusRecent: null };
  if (geste - premier.t > FENETRE_CALL_MS) return { etat: "attente", plusRecent: premier.call };

  const lisible = Boolean(premier.call.transcript?.trim() || premier.call.summary?.trim());
  return lisible ? { etat: "pret", call: premier.call } : { etat: "en_traitement", call: premier.call };
}

/** Les participants d'un call, quelle que soit la forme sous laquelle ils ont été rangés. */
export function lireParticipants(brut: unknown): ClaapParticipant[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((p): ClaapParticipant | null => {
      // Les premiers calls importés ne gardaient que l'adresse.
      if (typeof p === "string") return { email: p.trim().toLowerCase(), name: null, attended: null };
      if (p && typeof p === "object") {
        const o = p as Record<string, unknown>;
        return {
          email: typeof o.email === "string" ? o.email.trim().toLowerCase() : null,
          name: typeof o.name === "string" ? o.name : null,
          attended: typeof o.attended === "boolean" ? o.attended : null,
        };
      }
      return null;
    })
    .filter((p): p is ClaapParticipant => p !== null);
}

export type Destinataires = { to: string[]; cc: string[] };

/**
 * Qui reçoit le récap, et qui est en copie.
 *
 * Les destinataires sont les externes présents au call — ceux qui ont
 * entendu ce qu'on récapitule. Un invité absent n'est pas écarté pour autant
 * s'il est seul : mieux vaut un destinataire à confirmer qu'une popup vide.
 *
 * L'associé passe en copie s'il était au call, et seulement alors : le mettre
 * en copie d'un échange auquel il n'a pas pris part n'apprend rien au client,
 * et lui fait croire à une équipe plus nombreuse qu'elle ne l'était.
 */
export function choisirDestinataires(
  participants: ClaapParticipant[],
  expediteur: string,
  replis: string[],
): Destinataires {
  const moi = expediteur.trim().toLowerCase();
  const avecAdresse = participants.filter((p): p is ClaapParticipant & { email: string } => Boolean(p.email));

  const externes = avecAdresse.filter((p) => !isInternal(p.email));
  const presents = externes.filter((p) => p.attended !== false);
  const retenus = presents.length ? presents : externes;

  const to = [...new Set(retenus.map((p) => p.email))];
  const cc = [
    ...new Set(
      avecAdresse
        .filter((p) => isInternal(p.email) && p.email !== moi && p.attended !== false)
        .map((p) => p.email),
    ),
  ];

  // Sans aucun externe connu — un call importé sans adresses —, on se rabat
  // sur les interlocuteurs de l'affaire, à confirmer dans la popup.
  const repli = [...new Set(replis.map((e) => e.trim().toLowerCase()).filter((e) => e && !isInternal(e)))];
  return { to: to.length ? to : repli, cc };
}

/** Ce que le modèle rédige ; le reste de la structure est fixe. */
export type Redaction = {
  salutation: string;
  recap: string;
  prochaines_etapes: string[];
  /** La confirmation du prochain rendez-vous, tirée de l'agenda — jamais du modèle. */
  confirmation_rdv?: string | null;
};

/**
 * Le corps du mail, dans l'ordre demandé et nulle part ailleurs.
 *
 * La structure n'est pas confiée au modèle. Il rédige trois morceaux ; ils sont
 * assemblés ici, toujours de la même façon, avec les mêmes intertitres. Deux
 * récaps envoyés à une semaine d'écart doivent se ressembler, et un modèle
 * libre de la forme finit toujours par l'enjoliver.
 *
 * La signature n'en fait pas partie : elle est ajoutée à l'envoi, telle que
 * Gmail la connaît.
 */
export function assemblerCorps(redaction: Redaction): string {
  const etapes = redaction.prochaines_etapes
    .map((etape) => etape.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean)
    .map((etape) => `- ${etape}`)
    .join("\n");

  return [
    redaction.salutation.trim(),
    "Merci pour cet échange.",
    `Récap du call\n${redaction.recap.trim()}`,
    `Prochaines étapes\n${etapes}`,
    redaction.confirmation_rdv?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const INTERTITRES = ["Récap du call", "Prochaines étapes"];

function echapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Le corps en HTML, pour que le mail ressemble à un mail écrit à la main.
 *
 * Intertitres en gras, tirets en vraie liste, paragraphes séparés. Rien de
 * plus : pas de couleur, pas de police imposée — un récap commercial qui
 * ressemble à une newsletter se lit comme une newsletter.
 */
export function corpsEnHtml(corps: string): string {
  const blocs = corps.replace(/\r\n/g, "\n").split(/\n{2,}/);

  return blocs
    .map((bloc) => {
      const lignes = bloc.split("\n");
      const parties: string[] = [];
      let liste: string[] = [];

      const viderListe = () => {
        if (liste.length) parties.push(`<ul>${liste.map((l) => `<li>${l}</li>`).join("")}</ul>`);
        liste = [];
      };

      for (const ligne of lignes) {
        const propre = ligne.trim();
        if (/^[-•*]\s+/.test(propre)) {
          liste.push(echapper(propre.replace(/^[-•*]\s+/, "")));
          continue;
        }
        viderListe();
        if (!propre) continue;
        parties.push(
          INTERTITRES.includes(propre) ? `<p><strong>${echapper(propre)}</strong></p>` : `<p>${echapper(propre)}</p>`,
        );
      }
      viderListe();
      return parties.join("");
    })
    .join("");
}

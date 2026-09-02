import type { CallKind } from "@/lib/database.types";

/**
 * Rattachement d'un call Claap à une affaire.
 *
 * Le rapprochement est *déterministe* : l'adresse d'un participant externe doit
 * correspondre exactement à celle d'un contact du CRM. Aucune heuristique, aucun
 * modèle. Un call qu'on ne sait pas rattacher part dans la file d'attente pour
 * qu'un humain tranche — c'est plus lent, mais on ne se retrouve jamais avec un
 * historique d'échanges attribué à la mauvaise entreprise.
 */

/**
 * Les dossiers Claap portent déjà la qualification du rendez-vous : plutôt que
 * de demander un second étiquetage, on lit celui qui existe.
 */
const FOLDER_TO_KIND: Record<string, CallKind> = {
  r1: "r1",
  r2: "r2",
  "sales meetings": "decouverte",
  "internal meetings": "interne",
  demo: "demo",
  closing: "closing",
  suivi: "suivi",
};

export function kindFromFolder(folderTitle?: string | null): CallKind | null {
  if (!folderTitle) return null;
  return FOLDER_TO_KIND[folderTitle.trim().toLowerCase()] ?? null;
}

export type ClaapParticipant = { name?: string | null; email?: string | null };

export type NormalizedCall = {
  providerCallId: string;
  title: string | null;
  url: string | null;
  occurredOn: string | null;
  durationMinutes: number | null;
  kind: CallKind | null;
  externalEmails: string[];
  participants: ClaapParticipant[];
  suggestedCompany: string | null;
};

/** Domaines internes : leurs adresses ne comptent pas comme interlocuteur. */
const INTERNAL_DOMAINS = ["antichaos.fr", "antichaos.dev"];

function isInternal(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_DOMAINS.includes(domain);
}

/**
 * Lecture défensive du corps du webhook.
 *
 * Claap peut faire évoluer ses noms de champs sans nous prévenir ; on accepte
 * donc plusieurs graphies pour chacun, et le corps brut est conservé en base
 * pour pouvoir rejouer un rattachement si un champ nous avait échappé.
 */
export function normalizeClaapPayload(raw: Record<string, unknown>): NormalizedCall | null {
  const pick = <T>(...keys: string[]): T | null => {
    for (const key of keys) {
      const value = key.split(".").reduce<unknown>(
        (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
        raw,
      );
      if (value !== undefined && value !== null && value !== "") return value as T;
    }
    return null;
  };

  const providerCallId = pick<string>("recordingId", "recording.recordingId", "id", "data.recordingId");
  if (!providerCallId) return null;

  const rawPeople =
    pick<ClaapParticipant[]>("people", "recording.people", "participants", "attendees") ?? [];

  const participants = Array.isArray(rawPeople) ? rawPeople : [];
  const externalEmails = participants
    .map((person) => person?.email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email) && !isInternal(email!));

  const createdAt = pick<string>("createdAt", "recording.createdAt", "date", "startedAt");
  const durationSeconds = pick<number>("duration", "recording.duration", "durationSeconds");

  return {
    providerCallId,
    title: pick<string>("title", "recording.title"),
    url: pick<string>("url", "recording.url") ?? `https://app.claap.io/${providerCallId}`,
    occurredOn: createdAt ? String(createdAt).slice(0, 10) : null,
    durationMinutes: typeof durationSeconds === "number" ? Math.round(durationSeconds / 60) : null,
    kind: kindFromFolder(pick<string>("folder.title", "recording.folder.title", "folderTitle")),
    externalEmails,
    participants,
    // À défaut de correspondance, le domaine de l'interlocuteur est le meilleur
    // indice à présenter pour trancher.
    suggestedCompany:
      pick<string>("companies.0.name", "recording.companies.0.name") ??
      externalEmails[0]?.split("@")[1] ??
      null,
  };
}

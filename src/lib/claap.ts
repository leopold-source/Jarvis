/**
 * Lecture d'un événement Claap, et rattachement de son call à une affaire.
 *
 * Le rapprochement est *déterministe* : l'adresse d'un participant externe doit
 * correspondre exactement à celle d'un contact du CRM. Aucune heuristique, aucun
 * modèle. Un call qu'on ne sait pas rattacher part dans la file d'attente pour
 * qu'un humain tranche — c'est plus lent, mais on ne se retrouve jamais avec un
 * historique d'échanges attribué à la mauvaise entreprise.
 */

export type ClaapParticipant = {
  name?: string | null;
  email?: string | null;
  /** Présent au call, et pas seulement invité. */
  attended?: boolean | null;
};

export type NormalizedCall = {
  providerCallId: string;
  /** `recording_added`, `recording_updated`… quand Claap le précise. */
  eventType: string | null;
  title: string | null;
  url: string | null;
  occurredOn: string | null;
  /** L'heure exacte : deux calls le même jour se départagent à l'heure. */
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  /** Dossier Claap d'origine, conservé brut : la qualification s'en déduit
   *  par une règle configurable, jamais par une constante du code. */
  folderTitle: string | null;
  externalEmails: string[];
  /**
   * Claap tient la réunion pour externe, même sans adresse externe connue.
   *
   * Cela arrive : l'invitation ne listait que l'organisateur, et Claap a
   * reconnu l'entreprise à la voix ou au titre. Un tel call n'est pas une
   * réunion interne — il attend seulement qu'on dise à quelle affaire il va.
   */
  externe: boolean;
  participants: ClaapParticipant[];
  suggestedCompany: string | null;
  /** Le résumé de Claap, remis en un seul texte : points clés, actions, détail. */
  summary: string | null;
  /** Lien signé vers le transcript texte. Il expire en vingt-quatre heures. */
  transcriptUrl: string | null;
};

/** Domaines internes : leurs adresses ne comptent pas comme interlocuteur. */
export const INTERNAL_DOMAINS = ["antichaos.fr", "antichaos.dev"];

export function isInternal(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_DOMAINS.includes(domain);
}

type Objet = Record<string, unknown>;

function lire(racine: unknown, chemin: string): unknown {
  return chemin.split(".").reduce<unknown>(
    (acc, part) => (acc && typeof acc === "object" ? (acc as Objet)[part] : undefined),
    racine,
  );
}

function tableau(valeur: unknown): Objet[] {
  return Array.isArray(valeur) ? (valeur.filter((v) => v && typeof v === "object") as Objet[]) : [];
}

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : null;
}

/**
 * Le résumé de Claap, recomposé.
 *
 * Claap le livre en trois morceaux — points clés, actions, détail par thème —
 * que son interface affiche l'un sous l'autre. On les remet dans cet ordre, en
 * un seul texte, pour qu'il se lise dans le CRM comme dans Claap.
 *
 * Les marqueurs d'horodatage `%[14:36]()` renvoient à la vidéo dans Claap ;
 * hors de Claap ce sont des liens morts, on les retire.
 */
export function composerResume(recording: unknown): string | null {
  const blocs: string[] = [];

  const pointsCles = tableau(lire(recording, "keyTakeaways"))
    .map((item) => texte(item.text))
    .filter((t): t is string => Boolean(t));
  if (pointsCles.length) blocs.push(`## Points clés\n${pointsCles.join("\n\n")}`);

  const actions = tableau(lire(recording, "actionItems"))
    .flatMap((groupe) => tableau(groupe.items))
    .map((item) => texte(item.description))
    .filter((t): t is string => Boolean(t));
  if (actions.length) blocs.push(`## Actions\n${actions.map((a) => `- ${a}`).join("\n")}`);

  const detail = tableau(lire(recording, "outlines"))
    .map((item) => texte(item.text))
    .filter((t): t is string => Boolean(t));
  if (detail.length) blocs.push(`## Détail\n${detail.join("\n\n")}`);

  if (blocs.length === 0) return null;
  return blocs.join("\n\n").replace(/\s*%\[\d{1,2}:\d{2}(?::\d{2})?\]\(\)/g, "");
}

/**
 * Lecture défensive d'un événement Claap.
 *
 * La forme réelle, relevée sur les événements reçus, range tout sous
 * `event.recording` : l'identifiant y est `id`, les participants sous
 * `meeting.participants`, le transcript sous `transcripts[].textUrl`. Les
 * graphies plus anciennes restent acceptées — le corps brut est de toute façon
 * conservé, pour pouvoir rejouer un rattachement si un champ nous échappait.
 */
export function normalizeClaapPayload(raw: Objet): NormalizedCall | null {
  // L'enregistrement, où qu'il soit rangé.
  const recording =
    (lire(raw, "event.recording") as Objet | undefined) ??
    (lire(raw, "recording") as Objet | undefined) ??
    (lire(raw, "data.recording") as Objet | undefined) ??
    raw;

  const pick = <T>(...chemins: string[]): T | null => {
    for (const chemin of chemins) {
      const valeur = lire(recording, chemin) ?? lire(raw, chemin);
      if (valeur !== undefined && valeur !== null && valeur !== "") return valeur as T;
    }
    return null;
  };

  const providerCallId = pick<string>("id", "recordingId", "data.recordingId");
  if (!providerCallId || typeof providerCallId !== "string") return null;

  // Les invités de la réunion d'abord : ils portent l'adresse et la présence.
  // La liste `people` des anciennes graphies sert de repli.
  const bruts = [
    ...tableau(lire(recording, "meeting.participants")),
    ...tableau(lire(recording, "people")),
    ...tableau(lire(recording, "participants")),
    ...tableau(lire(recording, "attendees")),
  ];

  const parAdresse = new Map<string, ClaapParticipant>();
  const sansAdresse: ClaapParticipant[] = [];
  for (const brut of bruts) {
    const email = texte(brut.email)?.toLowerCase() ?? null;
    const personne: ClaapParticipant = {
      name: texte(brut.name),
      email,
      attended: typeof brut.attended === "boolean" ? brut.attended : null,
    };
    if (!email) {
      sansAdresse.push(personne);
      continue;
    }
    // Une même adresse peut figurer deux fois ; on garde l'information la
    // plus riche, et « présent » l'emporte sur « inconnu ».
    const deja = parAdresse.get(email);
    parAdresse.set(email, {
      name: deja?.name ?? personne.name,
      email,
      attended: deja?.attended === true || personne.attended === true ? true : (deja?.attended ?? personne.attended),
    });
  }
  const participants = [...parAdresse.values(), ...sansAdresse];

  const externalEmails = [...parAdresse.keys()].filter((email) => !isInternal(email));

  const startedAt = pick<string>("meeting.startingAt", "startedAt");
  const endedAt = pick<string>("meeting.endingAt", "endedAt");
  const createdAt = pick<string>("createdAt", "date");
  const durationSeconds = pick<number>("durationSeconds", "duration");

  const transcripts = tableau(lire(recording, "transcripts"));
  const transcript =
    transcripts.find((t) => t.isActive === true && t.isTranscript !== false) ?? transcripts[0];

  return {
    providerCallId,
    eventType: texte(lire(raw, "event.type")) ?? texte(lire(raw, "type")),
    title: pick<string>("title"),
    url: pick<string>("url") ?? `https://app.claap.io/${providerCallId}`,
    occurredOn: (startedAt ?? createdAt)?.slice(0, 10) ?? null,
    startedAt: startedAt ?? createdAt ?? null,
    endedAt,
    durationMinutes: typeof durationSeconds === "number" ? Math.round(durationSeconds / 60) : null,
    folderTitle: pick<string>("folder.title", "folderTitle"),
    externalEmails,
    externe:
      externalEmails.length > 0 ||
      texte(lire(recording, "meeting.type")) === "external" ||
      tableau(lire(recording, "companies")).length > 0,
    participants,
    // À défaut de correspondance, l'entreprise détectée par Claap est le
    // meilleur indice à présenter pour trancher.
    suggestedCompany:
      texte(lire(recording, "companies.0.name")) ?? externalEmails[0]?.split("@")[1] ?? null,
    summary: composerResume(recording),
    transcriptUrl: transcript ? (texte(transcript.textUrl) ?? texte(transcript.url)) : null,
  };
}

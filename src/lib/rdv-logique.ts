/**
 * Retrouver un rendez-vous dans l'agenda, et l'écrire dans un mail.
 *
 * Pur : ni Google ni base ici, pour que la règle se vérifie sans réseau. Un
 * rendez-vous « correspond » quand l'une des adresses du prospect figure parmi
 * les invités — ou l'organise. Sans correspondance, on n'invente pas de date :
 * le mail s'écrit sans.
 */
import type { CalendarEvent } from "@/lib/google";
import { FUSEAU } from "@/lib/utils";

export type RdvTrouve = {
  debut: string;
  fin: string | null;
  titre: string;
  visio: string | null;
  lien: string | null;
  /** L'agenda où on l'a trouvé : utile quand c'est l'associé qui l'a posé. */
  agenda: string | null;
};

function videoDe(event: CalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  return event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
}

/**
 * Le premier rendez-vous, à partir de `apres`, qui réunit l'une des adresses.
 *
 * Les journées entières sont ignorées : un « salon » ou un « congé » où le
 * prospect est invité n'est pas un rendez-vous avec lui.
 */
export function rdvAvec(
  events: CalendarEvent[],
  emails: string[],
  apres: number,
  agenda: string | null = null,
): RdvTrouve | null {
  const cherchees = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (cherchees.size === 0) return null;

  const candidats = events
    .filter((event) => {
      if (event.status === "cancelled" || !event.start?.dateTime) return false;
      if (Date.parse(event.start.dateTime) < apres) return false;
      const presents = [...(event.attendees ?? []).filter((a) => a.responseStatus !== "declined"), event.organizer ?? {}]
        .map((a) => a.email?.toLowerCase())
        .filter(Boolean);
      return presents.some((e) => cherchees.has(e!));
    })
    .sort((a, b) => Date.parse(a.start!.dateTime!) - Date.parse(b.start!.dateTime!));

  const premier = candidats[0];
  if (!premier) return null;
  return {
    debut: premier.start!.dateTime!,
    fin: premier.end?.dateTime ?? null,
    titre: premier.summary?.trim() || "Rendez-vous",
    visio: videoDe(premier),
    lien: premier.htmlLink ?? null,
    agenda,
  };
}

/** Le plus tôt de plusieurs résultats, un par agenda. */
export function plusTot(trouves: Array<RdvTrouve | null>): RdvTrouve | null {
  return (
    trouves
      .filter((r): r is RdvTrouve => r !== null)
      .sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut))[0] ?? null
  );
}

const JOUR = new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, weekday: "long", day: "numeric", month: "long" });
const HEURE = new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** « jeudi 2 octobre à 14h00 », à l'heure de Paris. */
export function dateEnClair(iso: string): string {
  const instant = new Date(iso);
  const parts = HEURE.formatToParts(instant);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${JOUR.format(instant)} à ${h}h${m}`;
}

/**
 * La phrase qui confirme le prochain rendez-vous, pour le mail récap R1 → R2.
 * Rien sans rendez-vous trouvé : une date fausse ferait plus de tort qu'aucune.
 */
export function phraseProchainRdv(rdv: Pick<RdvTrouve, "debut" | "visio"> | null, tutoiement: boolean): string | null {
  if (!rdv) return null;
  const toi = tutoiement ? "te" : "vous";
  return `Je ${toi} confirme notre prochain rendez-vous le ${dateEnClair(rdv.debut)}${rdv.visio ? ` (visio : ${rdv.visio})` : ""}.`;
}

export type MailConfirmation = { subject: string; body: string };

/**
 * Le mail qui suit le « call pris » : on remercie, on confirme la date.
 *
 * Un modèle fixe, sans modèle de langue : il part tel quel ou presque, et
 * Léopold le remplacera par le sien. Sans date trouvée, il reste vrai.
 */
export function mailConfirmation(options: {
  prenom: string | null;
  rdv: Pick<RdvTrouve, "debut" | "visio"> | null;
  tutoiement?: boolean;
}): MailConfirmation {
  const tu = options.tutoiement ?? false;
  const bonjour = options.prenom?.trim() ? `Bonjour ${options.prenom.trim()},` : "Bonjour,";
  const merci = tu
    ? "Merci pour ton temps au téléphone, ravi d'avoir pu échanger."
    : "Merci pour votre temps au téléphone, ravi d'avoir pu échanger.";

  if (!options.rdv) {
    return {
      subject: "Suite à notre échange",
      body: [
        bonjour,
        merci,
        tu
          ? "Comme convenu, je reviens vers toi pour caler notre rendez-vous."
          : "Comme convenu, je reviens vers vous pour caler notre rendez-vous.",
        tu ? "À très vite," : "À très bientôt,",
      ].join("\n\n"),
    };
  }

  const quand = dateEnClair(options.rdv.debut);
  const confirmation = tu
    ? `Je te confirme notre rendez-vous le ${quand}.`
    : `Je vous confirme notre rendez-vous le ${quand}.`;
  const visio = options.rdv.visio ? `Le lien de la visio : ${options.rdv.visio}` : null;
  return {
    subject: `Confirmation de notre rendez-vous du ${quand}`,
    body: [
      bonjour,
      merci,
      [confirmation, visio].filter(Boolean).join("\n"),
      tu
        ? "Si le créneau ne te convient plus, dis-le-moi et on le décale."
        : "Si le créneau ne vous convient plus, dites-le-moi et nous le décalerons.",
      tu ? "À très vite," : "À très bientôt,",
    ].join("\n\n"),
  };
}

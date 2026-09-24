/**
 * Ce qui n'est pas un échange.
 *
 * Invitations, acceptations, refus, nouvel horaire proposé : l'agenda écrit
 * autant que les gens, et ses messages noyaient le fil des affaires — neuf
 * sur dix-sept, à la première relecture. Ils ne disent rien qu'on ne sache
 * déjà par l'agenda lui-même.
 *
 * On ne regarde que l'objet et l'expéditeur. Une réponse écrite à la main à
 * une invitation (« Re: Refusé : … ») est un vrai échange et reste : le
 * « Re: » en tête la sauve.
 */

const EXPEDITEURS = [
  /^calendar-notification@google\.com$/,
  /@calendar-server\.bounces\.google\.com$/,
  /^meet-recordings-noreply@google\.com$/,
  /^no-?reply@zoom\.us$/,
  /^noreply@(?:teams\.)?microsoft\.com$/,
  /@(?:.*\.)?claap\.io$/,
];

const OBJETS = new RegExp(
  "^(?:" +
    [
      "invitation(?: mise à jour| modifiée| annulée)?",
      "updated invitation(?: with note)?",
      "invitation (?:updated|cancel(?:l)?ed)",
      "accepté(?:e)?",
      "accepted",
      "refusé(?:e)?",
      "declined",
      "provisoirement accepté(?:e)?|peut-être",
      "tentatively accepted|maybe",
      "nouvel horaire proposé",
      "new time proposed",
      "événement annulé",
      "cancel(?:l)?ed event",
    ].join("|") +
    ")\\s*[:：]",
  "i",
);

export function estNotificationAgenda(message: { subject: string | null; from: string | null }): boolean {
  const expediteur = message.from?.trim().toLowerCase() ?? "";
  if (EXPEDITEURS.some((motif) => motif.test(expediteur))) return true;
  const objet = message.subject?.trim() ?? "";
  return OBJETS.test(objet);
}

/**
 * Ce que la recherche Gmail écarte d'emblée : les messages portant une
 * invitation en pièce jointe, et les notifications de l'agenda. Ce qui passe
 * à travers est rattrapé par `estNotificationAgenda`.
 */
export const EXCLUSIONS_GMAIL = "-filename:ics -from:calendar-notification@google.com";

import type { CalendarEvent } from "@/lib/google";

/**
 * Un vrai rendez-vous, ou un créneau qu'on s'est réservé.
 *
 * Un agenda mélange deux choses qui n'ont rien à voir. Il y a les rendez-vous —
 * un client, un meet, quelqu'un d'autre au bout — et il y a les créneaux qu'on
 * se garde : « miam miam » à midi, « lecture » le soir. Les seconds ont leur
 * raison d'être dans Google Agenda, où ils protègent un morceau de journée.
 * Ils n'en ont aucune sur un tableau de bord qui répond à « qu'est-ce que j'ai
 * aujourd'hui » : ils y font passer une journée vide pour une journée pleine.
 *
 * La distinction ne se fait pas sur les mots. Une liste de titres à écarter
 * serait fausse la semaine où il écrit « déjeuner Dupont », et il faudrait la
 * tenir à jour à chaque nouvelle habitude. Elle se fait sur la structure, et la
 * structure dit la même chose de bien des façons : un rendez-vous engage
 * quelqu'un d'autre.
 */

/** Quelqu'un d'autre que soi, qui n'a pas décliné. */
function aDuMonde(event: CalendarEvent): boolean {
  return (event.attendees ?? []).some(
    (invite) => !invite.self && invite.responseStatus !== "declined",
  );
}

function aUneVisio(event: CalendarEvent): boolean {
  if (event.hangoutLink) return true;
  return Boolean(
    event.conferenceData?.entryPoints?.some((entree) => entree.entryPointType === "video"),
  );
}

/**
 * Vrai si l'événement est un vrai rendez-vous.
 *
 * Quatre signaux, dont un seul suffit :
 *
 * 1. Quelqu'un d'autre est invité. C'est la définition même.
 * 2. Il y a un lien de visio. On ne crée pas de Meet pour déjeuner seul.
 * 3. Ce n'est pas lui qui l'a créé. Une invitation acceptée est un engagement
 *    pris envers quelqu'un.
 * 4. C'est ponctuel et situé quelque part. Un rendez-vous client noté à la main
 *    n'a souvent ni invité ni visio — juste une adresse. La répétition est ce
 *    qui l'en distingue : une habitude revient, un rendez-vous arrive une fois.
 *
 * Reste le cas ambigu : l'événement solitaire, ponctuel, sans lieu. « Préparer
 * la propale Auddice » en est un, et ce n'est pas un rendez-vous — c'est un
 * créneau de travail. Il tombe donc du bon côté, mais il faut savoir que
 * l'appel se joue là, et c'est pourquoi rien n'est jeté : ce qui est écarté
 * reste affiché, plus bas et replié.
 */
export function estUnVraiRendezVous(event: CalendarEvent): boolean {
  if (aDuMonde(event)) return true;
  if (aUneVisio(event)) return true;
  if (event.organizer && event.organizer.self === false) return true;

  const recurrent = Boolean(event.recurringEventId);
  const situe = Boolean(event.location?.trim());
  return !recurrent && situe;
}

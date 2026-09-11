import "server-only";

import { eventVideoLink, listCalendarEvents, refreshAccessToken, type CalendarEvent } from "@/lib/google";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * L'agenda d'un utilisateur, ramené à ce qu'on affiche.
 *
 * Isolé du composant qui le montre : l'assistant vocal et le brief du matin
 * lisent la même chose, et un rendez-vous ne doit pas être décrit de trois
 * façons différentes selon l'écran qui le demande.
 *
 * Seul l'agenda principal est interrogé. Les agendas secondaires exigeraient
 * une requête par calendrier, pour un gain qui reste à démontrer sur une
 * équipe de deux.
 */

export type RendezVous = {
  id: string;
  titre: string;
  debut: string | null;
  fin: string | null;
  journee_entiere: boolean;
  lieu: string | null;
  visio: string | null;
  lien: string | null;
  participants: string[];
};

export type AgendaResultat =
  | { ok: true; rendezVous: RendezVous[] }
  | { ok: false; raison: "non_connecte" | "perimetre" | "erreur"; detail: string };

function enRendezVous(event: CalendarEvent): RendezVous {
  const journee = Boolean(event.start?.date && !event.start?.dateTime);
  return {
    id: event.id,
    titre: event.summary?.trim() || "Sans titre",
    debut: event.start?.dateTime ?? event.start?.date ?? null,
    fin: event.end?.dateTime ?? event.end?.date ?? null,
    journee_entiere: journee,
    lieu: event.location?.trim() || null,
    visio: eventVideoLink(event),
    lien: event.htmlLink ?? null,
    // Soi-même n'est pas un participant : le rappeler dans la liste n'apprend
    // rien et occupe la place du nom qu'on cherche.
    participants: (event.attendees ?? [])
      .filter((invite) => !invite.self && invite.responseStatus !== "declined")
      .map((invite) => invite.displayName ?? invite.email ?? "")
      .filter(Boolean)
      .slice(0, 6),
  };
}

export async function agendaDe(
  userId: string,
  options: { jours?: number } = {},
): Promise<AgendaResultat> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, raison: "erreur", detail: "Clé de service absente." };

  const { data: compte } = await admin
    .from("google_accounts")
    .select("refresh_token, scope")
    .eq("user_id", userId)
    .maybeSingle();

  if (!compte?.refresh_token) {
    return { ok: false, raison: "non_connecte", detail: "Aucun compte Google connecté." };
  }

  // Le jeton peut être antérieur à l'ajout de l'agenda : le dire ici évite un
  // 403 de Google que personne ne saurait interpréter.
  if (!compte.scope?.includes("calendar")) {
    return {
      ok: false,
      raison: "perimetre",
      detail: "Le compte a été connecté avant l'ajout de l'agenda.",
    };
  }

  try {
    const { access_token } = await refreshAccessToken(compte.refresh_token);

    // Depuis maintenant, pas depuis ce matin : un rendez-vous terminé à onze
    // heures n'a plus rien à faire dans « ce qui arrive ».
    const debut = new Date();
    const fin = new Date();
    fin.setDate(fin.getDate() + (options.jours ?? 1));
    fin.setHours(23, 59, 59, 999);

    const events = await listCalendarEvents(access_token, debut, fin);
    return { ok: true, rendezVous: events.map(enRendezVous) };
  } catch (caught) {
    return {
      ok: false,
      raison: "erreur",
      detail: caught instanceof Error ? caught.message : "Agenda illisible.",
    };
  }
}

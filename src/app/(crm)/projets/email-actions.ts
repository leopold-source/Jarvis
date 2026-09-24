"use server";

import { requireStaff } from "@/lib/auth";
import type { EmailMessage } from "@/lib/database.types";
import { estNotificationAgenda } from "@/lib/mail-bruit";
import { createClient } from "@/lib/supabase/server";

export type ProjectEmails =
  | { ok: true; messages: EmailMessage[]; connected: boolean; avantProjet: number }
  | { ok: false; error: string };

/**
 * Les échanges d'un projet, par trois chemins qui se rejoignent.
 *
 * Un projet naît d'une affaire, et la correspondance ne s'interrompt pas le
 * jour de la signature : les messages de la phase commerciale sont la trace de
 * ce qu'on a promis, et c'est précisément ce qu'on vient relire en cours de
 * chantier. Ils remontent donc avec le reste, comptés à part pour qu'on sache
 * ce qui précède le projet.
 *
 * Trois sources, parce qu'aucune ne suffit seule :
 *
 * - `project_id`, écrit par la synchronisation depuis qu'elle sait rattacher ;
 * - `deal_id`, qui rattrape tout ce qui a été classé avant cela ;
 * - les contacts de l'entreprise, qui rattrapent les projets créés à la main,
 *   sans affaire — c'est la moitié d'entre eux.
 *
 * Trois requêtes plutôt qu'un `.or()` : la syntaxe de filtre de PostgREST se
 * construit par concaténation de chaînes, et y injecter des identifiants
 * demande une prudence que trois requêtes simples rendent inutile.
 */
export async function fetchProjectEmails(projectId: string): Promise<ProjectEmails> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: projet, error: erreurProjet } = await supabase
    .from("projects")
    .select("id, deal_id, company_id, start_on, created_at")
    .eq("id", projectId)
    .maybeSingle();

  if (erreurProjet) return { ok: false, error: erreurProjet.message };
  if (!projet) return { ok: false, error: "Projet introuvable." };

  const contactIds: string[] = [];
  if (projet.company_id) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id")
      .eq("company_id", projet.company_id);
    contactIds.push(...(contacts ?? []).map((contact) => contact.id));
  }

  const colonnes = "*" as const;
  const requetes = [
    supabase.from("email_messages").select(colonnes).eq("project_id", projectId),
    projet.deal_id
      ? supabase.from("email_messages").select(colonnes).eq("deal_id", projet.deal_id)
      : null,
    contactIds.length > 0
      ? supabase.from("email_messages").select(colonnes).in("contact_id", contactIds)
      : null,
  ].filter((requete) => requete !== null);

  const resultats = await Promise.all(requetes);
  const echec = resultats.find((resultat) => resultat.error);
  if (echec?.error) return { ok: false, error: echec.error.message };

  // Les trois chemins se recoupent largement : un même message arrive par son
  // projet, son affaire et son contact. L'identifiant tranche.
  const parId = new Map<string, EmailMessage>();
  for (const resultat of resultats) {
    for (const message of (resultat.data ?? []) as EmailMessage[]) {
      if (estNotificationAgenda({ subject: message.subject, from: message.from_email })) continue;
      parId.set(message.id, message);
    }
  }

  const messages = [...parId.values()]
    .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))
    .slice(0, 80);

  // Ce qui précède le début du projet : à signaler, pas à cacher.
  const debut = projet.start_on ?? projet.created_at;
  const avantProjet = debut
    ? messages.filter((message) => (message.sent_at ?? "") < debut).length
    : 0;

  const { data: compte } = await supabase
    .from("google_accounts")
    .select("email")
    .eq("user_id", profile.id)
    .maybeSingle();

  return { ok: true, messages, connected: Boolean(compte), avantProjet };
}

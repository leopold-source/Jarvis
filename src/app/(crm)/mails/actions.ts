"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import {
  createDraft,
  refreshAccessToken,
  sendDraft,
  trashMessage,
  untrashMessage,
  updateDraft,
} from "@/lib/google";
import type { MailRun, MailTriage } from "@/lib/database.types";
import { RETENTION_JOURS } from "@/lib/constants";
import { trierMails } from "@/lib/mail-triage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * La relecture humaine, et le seul endroit d'où un mail part.
 *
 * L'IA prépare, range, signale. Elle n'envoie rien. Tout ce qui sort de la
 * boîte passe par une de ces fonctions, c'est-à-dire par un clic.
 */

/** Le jeton d'accès du compte connecté. Les brouillons appartiennent à sa boîte. */
async function jeton(userId: string): Promise<{ token: string } | { erreur: string }> {
  const admin = createAdminClient();
  if (!admin) return { erreur: "Clé SUPABASE_SERVICE_ROLE_KEY absente." };

  const { data } = await admin
    .from("google_accounts")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data?.refresh_token) return { erreur: "Aucun compte Google connecté." };

  try {
    const { access_token } = await refreshAccessToken(data.refresh_token);
    return { token: access_token };
  } catch (caught) {
    return { erreur: caught instanceof Error ? caught.message : "Jeton Google refusé." };
  }
}

/** Enregistre le brouillon modifié, côté base et côté Gmail. */
export async function enregistrerBrouillon(
  id: string,
  corps: string,
  objet: string,
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: ligne } = await supabase
    .from("mail_triage")
    .select("draft_id, thread_id, from_email")
    .eq("id", id)
    .maybeSingle();

  if (!ligne) return { ok: false, error: "Mail introuvable." };

  const acces = await jeton(profile.id);
  if ("erreur" in acces) return { ok: false, error: acces.erreur };

  try {
    // Le brouillon peut ne pas exister encore : l'IA n'a pas toujours su
    // rédiger, et l'humain écrit alors la première version.
    const options = {
      to: ligne.from_email ?? "",
      subject: objet,
      body: corps,
      threadId: ligne.thread_id,
    };

    const brouillon = ligne.draft_id
      ? await updateDraft(acces.token, ligne.draft_id, options)
      : await createDraft(acces.token, options);

    await supabase
      .from("mail_triage")
      .update({
        draft_id: brouillon.id,
        draft_body: corps,
        draft_subject: objet,
        action: "brouillon_pret",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Gmail a refusé." };
  }

  revalidatePath("/mails");
  return { ok: true };
}

/**
 * Envoie le brouillon.
 *
 * Le corps est réenregistré juste avant : sans cela, une modification faite à
 * l'écran et non sauvegardée partirait dans sa version précédente — l'erreur
 * serait invisible ici et visible chez le destinataire.
 */
export async function envoyerBrouillon(
  id: string,
  corps: string,
  objet: string,
): Promise<ActionResult> {
  const profile = await requireStaff();

  const enregistre = await enregistrerBrouillon(id, corps, objet);
  if (!enregistre.ok) return enregistre;

  const supabase = await createClient();
  const { data: ligne } = await supabase
    .from("mail_triage")
    .select("draft_id")
    .eq("id", id)
    .maybeSingle();

  if (!ligne?.draft_id) return { ok: false, error: "Aucun brouillon à envoyer." };

  const acces = await jeton(profile.id);
  if ("erreur" in acces) return { ok: false, error: acces.erreur };

  try {
    await sendDraft(acces.token, ligne.draft_id);
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Envoi refusé." };
  }

  await supabase
    .from("mail_triage")
    .update({
      review: "traite",
      sent_at: new Date().toISOString(),
      handled_at: new Date().toISOString(),
      handled_by: profile.id,
    })
    .eq("id", id);

  revalidatePath("/mails");
  return { ok: true };
}

/** Sort le mail de la file sans rien envoyer. */
export async function classerSansSuite(id: string): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase
    .from("mail_triage")
    .update({
      review: "ignore",
      handled_at: new Date().toISOString(),
      handled_by: profile.id,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/mails");
  return { ok: true };
}

/**
 * Met un message à la corbeille, ou l'en sort.
 *
 * La corbeille de Gmail n'est pas une suppression : trente jours de sursis, et
 * le périmètre OAuth demandé ne permettrait de toute façon rien de plus. C'est
 * ce qui autorise à proposer le geste d'un clic — et à proposer son contraire
 * juste à côté.
 */
export async function basculerCorbeille(id: string, versLaCorbeille: boolean): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: ligne } = await supabase
    .from("mail_triage")
    .select("provider_message_id")
    .eq("id", id)
    .maybeSingle();

  if (!ligne) return { ok: false, error: "Mail introuvable." };

  const acces = await jeton(profile.id);
  if ("erreur" in acces) return { ok: false, error: acces.erreur };

  try {
    if (versLaCorbeille) {
      await trashMessage(acces.token, ligne.provider_message_id);
    } else {
      await untrashMessage(acces.token, ligne.provider_message_id);
    }
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Gmail a refusé." };
  }

  await supabase
    .from("mail_triage")
    .update({
      action: versLaCorbeille ? "corbeille" : "etiquete",
      review: versLaCorbeille ? "traite" : "en_attente",
      handled_at: new Date().toISOString(),
      handled_by: profile.id,
    })
    .eq("id", id);

  revalidatePath("/mails");
  return { ok: true };
}

/**
 * Tout ce que le dernier passage a fait, et pas seulement ce qu'il a laissé.
 *
 * L'écran ne montrait que les mails en attente de décision : le reste — rangé,
 * écarté, répondu — disparaissait sans qu'on puisse le vérifier. Un tri qu'on
 * ne peut pas relire est un tri auquel on ne peut pas se fier.
 */
export async function fetchBilanTri(): Promise<{
  mails: MailTriage[];
  passage: MailRun | null;
}> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: passages }, { data: mails }] = await Promise.all([
    supabase
      .from("mail_runs")
      .select("*")
      .eq("user_id", profile.id)
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("mail_triage")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  const passage = ((passages ?? [])[0] as MailRun | undefined) ?? null;

  /*
    Les mails du dernier passage, désignés et non déduits.

    On comparait les horodatages : « tout ce qui est arrivé après le début du
    run, à une minute près ». C'était juste tant qu'il n'y avait qu'un passage
    à montrer, et faux dès que deux se suivaient de près — ou qu'une reprise
    effaçait puis réinsérait des lignes. La colonne `run_id` dit désormais qui
    appartient à quoi.
  */
  const retenus = ((mails ?? []) as MailTriage[]).filter(
    (mail) => passage !== null && mail.run_id === passage.id,
  );

  return { mails: retenus, passage };
}

/** Un passage, et les mails qu'il a produits. */
export type PassageDetaille = { passage: MailRun; mails: MailTriage[] };

/**
 * L'historique des passages, sur la fenêtre conservée.
 *
 * Le bilan seul — « 8 mails, 3 à la corbeille » — ne permet pas de vérifier
 * quoi que ce soit : c'est le détail qui dit si le tri d'avant-hier avait
 * raison. Les deux arrivent donc ensemble, en deux requêtes plutôt qu'une par
 * passage, et le rapprochement se fait ici.
 *
 * La fenêtre est celle de la péremption : au-delà, il n'y a plus rien à lire,
 * et prétendre le contraire ferait chercher des lignes que la base a effacées.
 */
export async function chargerHistorique(): Promise<PassageDetaille[]> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const depuis = new Date(Date.now() - RETENTION_JOURS * 86_400_000).toISOString();

  const { data: passages } = await supabase
    .from("mail_runs")
    .select("*")
    .eq("user_id", profile.id)
    .gte("started_at", depuis)
    .order("started_at", { ascending: false })
    .limit(60);

  const liste = (passages ?? []) as MailRun[];
  if (liste.length === 0) return [];

  const { data: mails } = await supabase
    .from("mail_triage")
    .select("*")
    .eq("user_id", profile.id)
    .in("run_id", liste.map((passage) => passage.id))
    .order("received_at", { ascending: false })
    .limit(1000);

  const parPassage = new Map<string, MailTriage[]>();
  for (const mail of (mails ?? []) as MailTriage[]) {
    if (!mail.run_id) continue;
    const groupe = parPassage.get(mail.run_id);
    if (groupe) groupe.push(mail);
    else parPassage.set(mail.run_id, [mail]);
  }

  return liste.map((passage) => ({ passage, mails: parPassage.get(passage.id) ?? [] }));
}

/**
 * Relance le tri à la demande, sans attendre le passage du lendemain.
 *
 * `reprise` repasse sur les messages déjà triés — à utiliser quand les
 * consignes ont changé et que le classement d'hier n'est plus le bon. C'est
 * le seul mode qui redépense des jetons sur du déjà-vu, d'où le fait qu'il
 * soit un geste séparé et non le comportement par défaut du bouton.
 */
export async function trierMaintenant(
  reprise = false,
): Promise<ActionResult<{ lus: number }>> {
  const profile = await requireStaff();
  const resultat = await trierMails(profile.id, { reprise });

  if (resultat.erreur) return { ok: false, error: resultat.erreur };

  revalidatePath("/mails");
  return { ok: true, data: { lus: resultat.lus } };
}

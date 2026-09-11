"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import { createDraft, refreshAccessToken, sendDraft, updateDraft } from "@/lib/google";
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

/** Relance le tri à la demande, sans attendre le passage du lendemain. */
export async function trierMaintenant(): Promise<ActionResult<{ lus: number }>> {
  const profile = await requireStaff();
  const resultat = await trierMails(profile.id);

  if (resultat.erreur) return { ok: false, error: resultat.erreur };

  revalidatePath("/mails");
  return { ok: true, data: { lus: resultat.lus } };
}

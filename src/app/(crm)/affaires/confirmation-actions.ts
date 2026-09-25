"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import { envoyerDepuisGmail, type MailAEnvoyer } from "@/lib/envoi-mail";
import { getSignature, refreshAccessToken } from "@/lib/google";
import { chercherRdv } from "@/lib/rdv-agenda";
import { dateEnClair, mailConfirmation, type RdvTrouve } from "@/lib/rdv-logique";
import { createClient } from "@/lib/supabase/server";
import { jourDe } from "@/lib/utils";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export type Confirmation = {
  to: string[];
  prenom: string | null;
  rdv: RdvTrouve | null;
  mail: { subject: string; body: string };
  expediteur: string | null;
  signature: string | null;
  /** La dernière confirmation envoyée pour cette affaire, s'il y en a une. */
  dejaEnvoyee: { at: string; rdv: string | null } | null;
};

/**
 * Tout ce qu'il faut pour le mail de confirmation : les destinataires, le
 * rendez-vous retrouvé dans l'agenda de l'équipe, et le brouillon.
 */
export async function preparerConfirmation(dealId: string): Promise<ActionResult<Confirmation>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: deal }, { data: liens }, { data: trace }, { data: compte }] = await Promise.all([
    supabase.from("deals").select("id, contact_id").eq("id", dealId).maybeSingle(),
    supabase.from("deal_contacts").select("contact_id, contacts (first_name, email)").eq("deal_id", dealId),
    supabase
      .from("activities")
      .select("created_at, payload")
      .eq("entity_type", "deal")
      .eq("entity_id", dealId)
      .eq("action", "rdv_confirme")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("google_accounts").select("email, refresh_token").eq("user_id", profile.id).maybeSingle(),
  ]);
  if (!deal) return { ok: false, error: "Affaire introuvable." };

  const contacts = ((liens ?? []) as unknown as Array<{
    contact_id: string;
    contacts: { first_name: string | null; email: string | null } | null;
  }>)
    .filter((l) => l.contacts?.email)
    // Le contact principal d'abord : c'est lui qu'on salue.
    .sort((a, b) => Number(b.contact_id === deal.contact_id) - Number(a.contact_id === deal.contact_id));

  const to = contacts.map((c) => c.contacts!.email!.toLowerCase());
  const prenom = contacts[0]?.contacts?.first_name ?? null;
  const rdv = await chercherRdv(to);

  let signature: string | null = null;
  if (compte?.refresh_token) {
    try {
      const { access_token } = await refreshAccessToken(compte.refresh_token);
      signature = await getSignature(access_token, compte.email);
    } catch {
      signature = null;
    }
  }

  const payload = (trace?.payload ?? null) as { rdv?: string | null } | null;
  return {
    ok: true,
    data: {
      to,
      prenom,
      rdv,
      mail: mailConfirmation({ prenom, rdv }),
      expediteur: compte?.email ?? null,
      signature,
      dejaEnvoyee: trace ? { at: trace.created_at, rdv: payload?.rdv ?? null } : null,
    },
  };
}

/**
 * Envoie la confirmation, et en garde la trace sur l'affaire : le mail rejoint
 * son fil, et une activité note le rendez-vous confirmé. Si l'affaire n'avait
 * pas de prochaine étape datée, le rendez-vous le devient.
 */
export async function envoyerConfirmation(
  dealId: string,
  mail: MailAEnvoyer,
  rdv: string | null,
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const envoi = await envoyerDepuisGmail(profile.id, mail, { dealId });
  if (!envoi.ok) return envoi;

  await supabase.from("activities").insert({
    entity_type: "deal",
    entity_id: dealId,
    action: "rdv_confirme",
    actor_id: profile.id,
    payload: { rdv, to: envoi.data.to, subject: mail.subject.trim(), gmail_message_id: envoi.data.id } as never,
  });

  if (rdv) {
    await supabase
      .from("deals")
      .update({ next_step: `Rendez-vous du ${dateEnClair(rdv)}`, next_step_on: jourDe(rdv) })
      .eq("id", dealId)
      .is("next_step_on", null);
  }

  revalidatePath("/affaires");
  return { ok: true };
}

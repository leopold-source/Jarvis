"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { DealRecap, RecapStatut } from "@/lib/database.types";
import { avancerRecap, demanderRecap } from "@/lib/deal-recap";
import { adresses, envoyerDepuisGmail } from "@/lib/envoi-mail";
import { getSignature, refreshAccessToken } from "@/lib/google";
import { choisirCall, type CallPourRecap } from "@/lib/recap-logique";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Les récaps qui demandent encore quelque chose : attendre, relire, réessayer. */
const OUVERTS: RecapStatut[] = ["en_attente_call", "redaction", "pret", "echec"];

/** Où en sont les récaps ouverts. Interrogé tant qu'un récap se prépare. */
export async function fetchRecapsOuverts(): Promise<Array<Pick<DealRecap, "id" | "deal_id" | "status" | "updated_at">>> {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_recaps")
    .select("id, deal_id, status, updated_at")
    .in("status", OUVERTS)
    .order("requested_at", { ascending: false });
  return data ?? [];
}

export type RecapDetail = {
  recap: DealRecap;
  call: { id: string; title: string | null; quand: string | null; url: string | null } | null;
  /** Quand on attend : le plus récent call connu, à proposer à la main. */
  plusRecent: { id: string; title: string | null; quand: string | null } | null;
  expediteur: string | null;
  signature: string | null;
};

/** Le dernier récap d'une affaire, avec ce qu'il faut pour le relire et l'envoyer. */
export async function fetchRecapDeLAffaire(dealId: string): Promise<ActionResult<RecapDetail | null>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: recap } = await supabase
    .from("deal_recaps")
    .select("*")
    .eq("deal_id", dealId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!recap) return { ok: true, data: null };

  const { data: calls } = await supabase
    .from("call_records")
    .select("id, title, started_at, occurred_on, url, transcript, summary, has_external, participants")
    .eq("deal_id", dealId)
    .order("occurred_on", { ascending: false })
    .limit(20);
  const liste = (calls ?? []) as Array<CallPourRecap & { title: string | null; url: string | null }>;

  const retenu = recap.call_record_id ? liste.find((c) => c.id === recap.call_record_id) : null;
  const choix = recap.status === "en_attente_call" ? choisirCall(liste, recap.requested_at) : null;
  const plusRecent = choix?.etat === "attente" ? choix.plusRecent : null;
  const complet = plusRecent ? liste.find((c) => c.id === plusRecent.id) : null;

  // La signature est celle de qui enverra : la personne qui a la popup
  // ouverte, pas forcément celle qui a déplacé la carte.
  const { data: compte } = await supabase
    .from("google_accounts")
    .select("email, refresh_token")
    .eq("user_id", profile.id)
    .maybeSingle();

  let signature: string | null = null;
  if (compte?.refresh_token && recap.status === "pret") {
    try {
      const { access_token } = await refreshAccessToken(compte.refresh_token);
      signature = await getSignature(access_token, compte.email);
    } catch {
      signature = null;
    }
  }

  return {
    ok: true,
    data: {
      recap: recap as DealRecap,
      call: retenu
        ? { id: retenu.id, title: retenu.title, quand: retenu.started_at ?? retenu.occurred_on, url: retenu.url }
        : null,
      plusRecent: complet
        ? { id: complet.id, title: complet.title, quand: complet.started_at ?? complet.occurred_on }
        : null,
      expediteur: compte?.email ?? null,
      signature,
    },
  };
}

type Brouillon = { to: string[]; cc: string[]; subject: string; body: string };


/** Garde les modifications sans envoyer. */
export async function enregistrerRecap(id: string, brouillon: Brouillon): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const to = adresses(brouillon.to);
  const cc = adresses(brouillon.cc);

  const { error } = await supabase
    .from("deal_recaps")
    .update({ to_emails: to.ok, cc_emails: cc.ok, subject: brouillon.subject, body: brouillon.body })
    .eq("id", id)
    .eq("status", "pret");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Envoie le récap, depuis la boîte de la personne qui appuie sur le bouton.
 *
 * C'est le seul endroit de l'application qui écrit à un client, et il ne le
 * fait qu'ici, sur un geste explicite, après relecture. Le message part avec
 * la signature Gmail de l'expéditeur, se range dans ses « Envoyés », et
 * rejoint le fil de l'affaire comme n'importe quel échange synchronisé.
 */
export async function envoyerRecap(id: string, brouillon: Brouillon): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: recap } = await supabase.from("deal_recaps").select("*").eq("id", id).maybeSingle();
  if (!recap) return { ok: false, error: "Récap introuvable." };
  if (recap.status === "envoye") return { ok: false, error: "Ce récap est déjà parti." };

  const envoi = await envoyerDepuisGmail(profile.id, brouillon, { dealId: recap.deal_id });
  if (!envoi.ok) return envoi;

  await supabase
    .from("deal_recaps")
    .update({
      status: "envoye",
      sent_at: envoi.data.at,
      gmail_message_id: envoi.data.id,
      to_emails: envoi.data.to,
      cc_emails: envoi.data.cc,
      subject: brouillon.subject.trim(),
      body: brouillon.body,
    })
    .eq("id", id);

  revalidatePath("/affaires");
  return { ok: true };
}

/** Écarte un récap : le call ne s'y prêtait pas, ou il a été écrit à la main. */
export async function ecarterRecap(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("deal_recaps")
    .update({ status: "ecarte" })
    .eq("id", id)
    .neq("status", "envoye");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/affaires");
  return { ok: true };
}

/**
 * Relance la rédaction : après un échec, ou sur un call désigné à la main.
 *
 * Désigner le call sert quand celui du jour n'arrivera pas — pas enregistré,
 * ou enregistré ailleurs — et qu'on préfère un récap tiré du précédent plutôt
 * que pas de récap du tout.
 */
export async function relancerRecap(id: string, callId?: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  // Revenir en attente rend la rédaction possible ; `avancerRecap` refait le
  // reste, avec son verrou.
  await supabase.from("deal_recaps").update({ status: "en_attente_call", error: null }).eq("id", id).in("status", ["echec", "en_attente_call"]);

  const resultat = await avancerRecap(id, callId ? { callId } : {});
  revalidatePath("/affaires");
  if (resultat?.status === "echec") return { ok: false, error: resultat.error ?? "Rédaction impossible." };
  return { ok: true };
}

/** Prépare un récap à la main, hors passage en R2 — ou le relance quand il a été écarté. */
export async function preparerRecap(dealId: string): Promise<ActionResult> {
  const profile = await requireStaff();
  await demanderRecap(dealId, profile.id);
  revalidatePath("/affaires");
  return { ok: true };
}

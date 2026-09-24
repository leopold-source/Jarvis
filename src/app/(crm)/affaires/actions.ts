"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import type { DealStage } from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import { demanderRecap } from "@/lib/deal-recap";
import { amorcerProjet } from "@/lib/projet-amorce";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Déplace une affaire dans le Kanban.
 *
 * Le passage en « gagné » déclenche côté base la création du projet ; on
 * l'amorce ensuite avec un squelette de jalons et de tâches pour que le chef de
 * projet ne parte pas d'une page blanche.
 */
export async function moveDeal(
  id: string,
  stage: DealStage,
  position: number,
): Promise<ActionResult<{ projectId?: string; recap?: boolean }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: before } = await supabase.from("deals").select("stage").eq("id", id).single();

  const { error } = await supabase.from("deals").update({ stage, position }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  let projectId: string | undefined;
  if (stage === "gagne" && before?.stage !== "gagne") {
    projectId = (await amorcerProjet(supabase, id)) ?? undefined;
  }

  /*
    R1 → R2 : un call vient presque toujours d'avoir lieu, et c'est le moment
    d'en envoyer le récap. On le prépare après la réponse — la carte change de
    colonne tout de suite, le brouillon arrive quand Claap et le modèle ont
    fini. Rien ne part sans qu'on l'ait relu.
  */
  const recap = before?.stage === "r1" && stage === "r2";
  if (recap) after(() => demanderRecap(id, profile.id));

  revalidatePath("/affaires");
  revalidatePath("/projets");
  return { ok: true, data: { projectId, recap } };
}

export async function updateDeal(
  id: string,
  patch: {
    name?: string;
    amount?: number | null;
    description?: string | null;
    next_step?: string | null;
    next_step_on?: string | null;
    expected_close_on?: string | null;
    lost_reason?: string | null;
    owner_id?: string | null;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("deals").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true };
}

export async function createDeal(input: {
  name: string;
  company_id?: string | null;
  contact_id?: string | null;
  amount?: number | null;
}): Promise<ActionResult<{ id: string }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deals")
    .insert({
      ...input,
      stage: "demande_rdv_envoyee",
      owner_id: profile.id,
      created_by: profile.id,
      position: Date.now() % 1_000_000,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true, data: { id: data.id } };
}

export async function deleteDeal(id: string): Promise<ActionResult> {
  const profile = await requireStaff();
  if (profile.role !== "admin") return { ok: false, error: "Réservé aux administrateurs." };

  const supabase = await createClient();
  const { error } = await supabase.from("deals").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true };
}

/* ------------------------------------------- Les interlocuteurs d'une affaire */

export type DealContactLigne = {
  contact_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  role: string | null;
  /** Celui que désigne `deals.contact_id` : le correspondant de référence. */
  principal: boolean;
};

/**
 * Tous les interlocuteurs d'une affaire, le principal en tête.
 *
 * Une jointure plutôt que deux requêtes : la liste ne sert à rien sans les
 * noms, et la lire en deux temps ferait clignoter le tiroir.
 */
export async function fetchDealContacts(
  dealId: string,
): Promise<ActionResult<DealContactLigne[]>> {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: liens, error }, { data: affaire }] = await Promise.all([
    supabase
      .from("deal_contacts")
      .select("contact_id, role, contacts (full_name, email, phone, job_title)")
      .eq("deal_id", dealId),
    supabase.from("deals").select("contact_id").eq("id", dealId).maybeSingle(),
  ]);

  if (error) return { ok: false, error: error.message };

  type Jointure = {
    contact_id: string;
    role: string | null;
    contacts: { full_name: string | null; email: string | null; phone: string | null; job_title: string | null } | null;
  };

  const principal = affaire?.contact_id ?? null;
  const lignes: DealContactLigne[] = ((liens ?? []) as unknown as Jointure[]).map((lien) => ({
    contact_id: lien.contact_id,
    full_name: lien.contacts?.full_name ?? null,
    email: lien.contacts?.email ?? null,
    phone: lien.contacts?.phone ?? null,
    job_title: lien.contacts?.job_title ?? null,
    role: lien.role,
    principal: lien.contact_id === principal,
  }));

  // Le principal d'abord, puis par nom : une liste qui se réordonne à chaque
  // ajout ne se relit pas.
  lignes.sort((a, b) => {
    if (a.principal !== b.principal) return a.principal ? -1 : 1;
    return (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? "");
  });

  return { ok: true, data: lignes };
}

/** Ajoute un interlocuteur à une affaire. Réappeler avec un rôle le met à jour. */
export async function addDealContact(
  dealId: string,
  contactId: string,
  role?: string | null,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase
    .from("deal_contacts")
    .upsert({ deal_id: dealId, contact_id: contactId, role: role?.trim() || null }, {
      onConflict: "deal_id,contact_id",
    });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true };
}

/**
 * Retire un interlocuteur — sauf le principal.
 *
 * Le refus n'est pas une précaution de façade : un déclencheur remet le
 * principal dans la liste dès que l'affaire est modifiée. Le retirer semblerait
 * fonctionner, puis le verrait réapparaître au premier enregistrement, sans que
 * rien n'explique pourquoi. Mieux vaut le dire tout de suite : on change de
 * principal, on ne le retire pas.
 */
export async function removeDealContact(
  dealId: string,
  contactId: string,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { data: affaire } = await supabase
    .from("deals")
    .select("contact_id")
    .eq("id", dealId)
    .maybeSingle();

  if (affaire?.contact_id === contactId) {
    return {
      ok: false,
      error: "C'est le contact principal : désignez-en un autre avant de le retirer.",
    };
  }

  const { error } = await supabase
    .from("deal_contacts")
    .delete()
    .eq("deal_id", dealId)
    .eq("contact_id", contactId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true };
}

/**
 * Désigne le correspondant de référence.
 *
 * C'est lui qu'affichent le tableau, le portail et les rappels : il change donc
 * `deals.contact_id`, et le déclencheur se charge de le laisser dans la liste.
 */
export async function setMainDealContact(
  dealId: string,
  contactId: string,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("deals").update({ contact_id: contactId }).eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { CallInbox, CallKind, CallRecord } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Calls rattachés à une affaire ou à un projet, du plus récent au plus ancien. */
export async function fetchCalls(
  target: CallTarget,
): Promise<{ ok: true; calls: CallRecord[] } | { ok: false; error: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_records")
    .select("*")
    .eq(target.kind === "affaire" ? "deal_id" : "project_id", target.id)
    .order("occurred_on", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, calls: (data ?? []) as CallRecord[] };
}

/** Requalifie un call (R1, R2…) sans quitter la fiche de l'affaire. */
export async function setCallKind(callId: string, kind: CallKind | null): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("call_records").update({ kind }).eq("id", callId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/affaires");
  return { ok: true };
}

export async function fetchPendingCalls(): Promise<CallInbox[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("call_inbox")
    .select("*")
    .eq("status", "en_attente")
    .order("occurred_on", { ascending: false });
  return (data ?? []) as CallInbox[];
}

export type CallTarget = { kind: "affaire" | "projet"; id: string };

/**
 * Rattache un call en attente à une affaire ou à un projet.
 *
 * La ligne quitte la file et rejoint l'historique de la cible : c'est la même
 * table que les calls rattachés automatiquement, donc les compteurs et les
 * analyses n'ont pas à distinguer les deux origines.
 */
export async function resolvePendingCall(
  inboxId: string,
  target: CallTarget,
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: pending, error: readError } = await supabase
    .from("call_inbox")
    .select("*")
    .eq("id", inboxId)
    .maybeSingle();
  if (readError || !pending) return { ok: false, error: readError?.message ?? "Call introuvable." };

  // On reprend l'entreprise et le contact de la cible : un call rattaché à la
  // main doit porter les mêmes liens qu'un call rattaché automatiquement.
  const { data: parent } = await (target.kind === "affaire"
    ? supabase.from("deals").select("company_id, contact_id").eq("id", target.id).maybeSingle()
    : supabase.from("projects").select("company_id, contact_id").eq("id", target.id).maybeSingle());

  const { error: insertError } = await supabase.from("call_records").insert({
    provider: pending.provider,
    provider_call_id: pending.provider_call_id,
    deal_id: target.kind === "affaire" ? target.id : null,
    project_id: target.kind === "projet" ? target.id : null,
    company_id: parent?.company_id ?? null,
    contact_id: parent?.contact_id ?? null,
    title: pending.title,
    url: pending.url,
    occurred_on: pending.occurred_on,
    has_external: true,
    participants: pending.participants,
    raw_payload: pending.raw_payload,
    synced_by: profile.id,
  });
  if (insertError) return { ok: false, error: insertError.message };

  const { error } = await supabase
    .from("call_inbox")
    .update({
      status: "traite",
      resolved_deal_id: target.kind === "affaire" ? target.id : null,
      resolved_project_id: target.kind === "projet" ? target.id : null,
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", inboxId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  revalidatePath("/projets");
  return { ok: true };
}

/** Écarte un call : réunion interne, démo produit, échange hors CRM. */
export async function dismissPendingCall(inboxId: string): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("call_inbox")
    .update({ status: "ignore", resolved_by: profile.id, resolved_at: new Date().toISOString() })
    .eq("id", inboxId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/affaires");
  return { ok: true };
}

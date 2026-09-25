"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * L'étape est faite : elle quitte la liste. La trace reste dans l'historique
 * de l'affaire ; la suivante se fixe depuis la fiche.
 */
export async function etapeFaite(dealId: string): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const { data: deal } = await supabase.from("deals").select("next_step, next_step_on").eq("id", dealId).maybeSingle();
  const { error } = await supabase.from("deals").update({ next_step: null, next_step_on: null }).eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  await supabase.from("activities").insert({
    entity_type: "deal",
    entity_id: dealId,
    action: "etape_faite",
    actor_id: profile.id,
    payload: { etape: deal?.next_step ?? null, prevue_le: deal?.next_step_on ?? null } as never,
  });
  revalidatePath("/");
  revalidatePath("/affaires");
  return { ok: true };
}

/** Repousse la prochaine étape à une autre date. */
export async function reporterEtape(dealId: string, jour: string): Promise<ActionResult> {
  await requireStaff();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return { ok: false, error: "Date invalide." };
  const supabase = await createClient();
  const { error } = await supabase.from("deals").update({ next_step_on: jour }).eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/affaires");
  return { ok: true };
}

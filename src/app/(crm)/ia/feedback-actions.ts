"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { AiFeedbackBilan, AiKind } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Le jugement porté sur ce que l'IA propose.
 *
 * L'application produit des suggestions, des classements, des brouillons —
 * et jusqu'ici personne ne mesurait s'ils étaient justes. Sans cette trace, on
 * ne peut que deviner : dans trois mois, ni quoi automatiser davantage, ni quoi
 * couper. Un pouce suffit à trancher, la note explique, et c'est la note qui
 * sert vraiment quand il faudra corriger une consigne.
 */
export async function juger(
  kind: AiKind,
  ref: string | null,
  utile: boolean,
  note?: string,
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  // Un avis se change : le même jugement réémis remplace le précédent plutôt
  // que d'empiler deux verdicts contradictoires sur la même proposition.
  const { error } = await supabase.from("ai_feedback").upsert(
    {
      kind,
      ref,
      utile,
      note: note?.trim() || null,
      user_id: profile.id,
      created_at: new Date().toISOString(),
    },
    { onConflict: "kind,ref,user_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/mails");
  return { ok: true };
}

/** Ce que les jugements accumulés disent, par famille de propositions. */
export async function bilanIa(): Promise<AiFeedbackBilan[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("ai_feedback_bilan").select("*");
  return (data ?? []) as AiFeedbackBilan[];
}

"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/utils";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Une ligne « affaire » du plan est faite : on la coche, et on fixe la suite.
 *
 * La prochaine étape remplace l'ancienne — c'est ce qui fait avancer
 * l'affaire et l'empêche de revenir demain sans suite. Sans étape suivante
 * (« Plus tard »), l'étape faite est vidée et la ligne sort du plan pour
 * aujourd'hui ; si l'affaire reste sans suite, elle reviendra, et c'est voulu.
 */
export async function faireAvancer(
  dealId: string,
  suite: { etape: string | null; le: string | null },
): Promise<ActionResult> {
  const profile = await requireStaff();
  if (suite.le && !/^\d{4}-\d{2}-\d{2}$/.test(suite.le)) return { ok: false, error: "Date invalide." };
  const supabase = await createClient();

  const { data: avant } = await supabase.from("deals").select("next_step, next_step_on").eq("id", dealId).maybeSingle();
  const { error } = await supabase
    .from("deals")
    .update({ next_step: suite.etape?.trim() || null, next_step_on: suite.le || null })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };

  await Promise.all([
    supabase.from("activities").insert({
      entity_type: "deal",
      entity_id: dealId,
      action: "etape_faite",
      actor_id: profile.id,
      payload: {
        faite: avant?.next_step ?? null,
        prevue_le: avant?.next_step_on ?? null,
        suivante: suite.etape?.trim() || null,
        suivante_le: suite.le || null,
      } as never,
    }),
    supabase
      .from("suggestion_done")
      .upsert({ suggestion_date: todayIso(), item_key: `deal:${dealId}`, user_id: profile.id }),
  ]);

  revalidatePath("/");
  revalidatePath("/affaires");
  revalidatePath("/leads");
  return { ok: true };
}

/**
 * « Prospecter quand même » : la prospection libre s'ouvre avant que le plan
 * soit vide. On le laisse faire, et on en garde la trace.
 */
export async function forcerProspection(affaires: number, relances: number): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  await supabase.from("activities").insert({
    entity_type: "lead",
    entity_id: profile.id,
    action: "prospection_forcee",
    actor_id: profile.id,
    payload: { affaires_restantes: affaires, relances_restantes: relances, jour: todayIso() } as never,
  });
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireStaff } from "@/lib/auth";
import type { DealActivityRule, DealStage } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Les seuils de dormance.
 *
 * Ils vivent en base et non dans le code : décider qu'une propale sans réponse
 * dort au bout de soixante jours est un arbitrage commercial, pas une règle
 * technique. Il doit pouvoir changer sans redéploiement, et le compte des
 * affaires concernées permet de voir tout de suite ce que le nouveau seuil
 * ferait basculer.
 */
export async function fetchDormancyRules(): Promise<{
  rules: DealActivityRule[];
  dormants: Record<string, number>;
}> {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: rules }, { data: health }] = await Promise.all([
    supabase.from("deal_activity_rules").select("*").order("max_days_active"),
    supabase.from("deal_health").select("stage, sante"),
  ]);

  const dormants: Record<string, number> = {};
  for (const row of health ?? []) {
    if (row.sante === "dormant" && row.stage) {
      dormants[row.stage] = (dormants[row.stage] ?? 0) + 1;
    }
  }

  return { rules: (rules ?? []) as DealActivityRule[], dormants };
}

export async function setDormancyRule(
  stage: DealStage,
  maxDaysActive: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();

  // Retirer la règle, c'est déclarer que cette étape ne dort jamais — le cas du
  // no-show, où le process est engagé mais où aucune propale n'est encore
  // partie : rien ne s'y éteint faute de réponse.
  const { error } =
    maxDaysActive === null
      ? await supabase.from("deal_activity_rules").delete().eq("stage", stage)
      : await supabase
          .from("deal_activity_rules")
          .upsert({ stage, max_days_active: Math.max(0, Math.round(maxDaysActive)) });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/parametres");
  revalidatePath("/");
  revalidatePath("/affaires");
  return { ok: true };
}

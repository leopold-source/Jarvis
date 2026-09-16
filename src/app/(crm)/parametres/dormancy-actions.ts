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

/**
 * Les réglages de prospection, réunis sous une même clé.
 *
 * `lead_dormancy_days` vaut `null` tant que personne ne l'a renseigné, et ce
 * `null` n'est pas un zéro déguisé : il veut dire « ne considère pas du tout
 * la dormance ». Un défaut implicite aurait marqué des fiches comme endormies
 * sans que quiconque l'ait demandé, ce qui est la pire façon d'introduire une
 * notion — on la découvre en constatant ses effets.
 */
export type ReglagesProspection = {
  org_cooldown_days: number;
  lead_dormancy_days: number | null;
};

async function lireProspection(): Promise<ReglagesProspection> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "prospection")
    .maybeSingle();

  const brut = (data?.value ?? {}) as {
    org_cooldown_days?: number;
    lead_dormancy_days?: number | null;
  };

  const dormance = brut.lead_dormancy_days;
  return {
    org_cooldown_days: Number(brut.org_cooldown_days ?? 30),
    lead_dormancy_days:
      typeof dormance === "number" && dormance > 0 ? Math.round(dormance) : null,
  };
}

export async function fetchProspectionSettings(): Promise<ReglagesProspection> {
  await requireStaff();
  return lireProspection();
}

/** Le délai au-delà duquel un appel chez la même organisation n'est plus un doublon. */
export async function fetchOrgCooldown(): Promise<number> {
  await requireStaff();
  return (await lireProspection()).org_cooldown_days;
}

/*
  Écrire un réglage sans effacer son voisin.

  Les deux vivent sous la même clé, et `upsert` remplace la valeur entière :
  enregistrer le délai d'organisation faisait disparaître le seuil de dormance,
  et réciproquement. Le défaut ne se voyait qu'après coup, sur l'autre écran.
*/
async function ecrireProspection(
  patch: Partial<ReglagesProspection>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();

  const actuel = await lireProspection();
  const { error } = await supabase.from("app_settings").upsert({
    key: "prospection",
    value: { ...actuel, ...patch },
    updated_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/parametres");
  revalidatePath("/leads");
  revalidatePath("/");
  return { ok: true };
}

export async function setOrgCooldown(days: number) {
  return ecrireProspection({ org_cooldown_days: Math.max(0, Math.round(days)) });
}

/**
 * Le seuil au-delà duquel un lead sans changement de statut est dit endormi.
 *
 * `null` éteint la notion, et c'est l'état de départ : tant que Léopold n'a pas
 * choisi un nombre de jours, aucune fiche n'est marquée, aucun filtre n'apparaît.
 */
export async function setLeadDormancy(days: number | null) {
  return ecrireProspection({
    lead_dormancy_days: days === null || days <= 0 ? null : Math.round(days),
  });
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

/**
 * Combien de leads le seuil ferait basculer aujourd'hui.
 *
 * Un seuil se juge à ce qu'il produit, pas dans l'abstrait : « 30 jours » ne
 * dit rien, « 30 jours, soit 214 fiches » dit tout. Sans seuil, rien à
 * compter — on ne va pas interroger la base pour apprendre zéro.
 */
export async function compterLeadsEndormis(seuil: number | null): Promise<number> {
  if (seuil === null) return 0;
  await requireStaff();
  const supabase = await createClient();

  const limite = new Date(Date.now() - seuil * 86_400_000).toISOString();
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .lt("status_changed_at", limite)
    // Une fiche convertie ou écartée ne dort pas : elle est arrivée au bout.
    .not("status", "in", "(call_pris,non_qualifie,pas_interesse)");

  return count ?? 0;
}

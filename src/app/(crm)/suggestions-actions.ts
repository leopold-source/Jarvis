"use server";

import { revalidatePath } from "next/cache";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { requireStaff } from "@/lib/auth";
import { MISSING_KEY_ERROR, anthropicClient, anthropicKey, describeAnthropicError } from "@/lib/anthropic";
import { chargerPlan } from "@/lib/plan-du-jour";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/utils";

/**
 * Ce que l'IA ajoute au plan du jour — et seulement cela.
 *
 * La liste des choses à faire ne vient pas du modèle : elle se calcule à
 * partir du CRM (voir `plan-logique`), pour qu'il n'y ait qu'une source de
 * vérité et aucun doublon. Le modèle écrit deux choses par-dessus : le cap du
 * jour, aligné sur l'objectif du pipeline, et pour chaque affaire le geste
 * concret à faire. Haiku suffit : tout est déjà trié, il ne fait que formuler.
 */

const Annotations = z.object({
  cap: z.string().describe("La ligne directrice du jour, moins de 90 caractères, alignée sur l'objectif"),
  gestes: z
    .array(
      z.object({
        cle: z.string().describe("La clé exacte de l'affaire, reprise telle quelle (deal:…)"),
        geste: z.string().describe("Le geste concret, à l'impératif, moins de 110 caractères"),
      }),
    )
    .describe("Un geste par affaire fournie, au plus"),
});

const CONSIGNES = `Tu aides les deux associés d'Antichaos — agence qui forme les PME et bureaux d'études à l'IA et l'intègre dans leurs outils — à attaquer leur journée commerciale.

On te donne le plan du jour déjà trié par importance : chaque affaire avec sa raison d'être là (étape en retard, no-show, devis expiré, récap à envoyer, affaire en sommeil…), son étape et son montant, et l'objectif du moment.

Tu rends :
- le cap : une phrase qui dit sur quoi mettre l'énergie aujourd'hui, reliée à l'objectif s'il y en a un ;
- pour chaque affaire, le geste concret : qui appeler ou à qui écrire, pour obtenir quoi. Précis et actionnable (« Appeler le DG pour caler le R2 cette semaine », « Relancer par mail sur le devis en proposant un créneau »), jamais « faire le point ».

Reprends les clés exactement. N'invente ni nom de personne ni fait absent des données.`;

export type SuggestionsResult = { ok: true } | { ok: false; error: string };

/** Depuis l'interface : régénère le cap et les gestes du jour. */
export async function generateSuggestions(): Promise<SuggestionsResult> {
  await requireStaff();
  return runSuggestions(true);
}

/**
 * Génération sans contrôle de session : appelée aussi par le cron du matin.
 * Sans `force`, ne refait pas ce qui existe déjà pour aujourd'hui.
 */
export async function runSuggestions(force = false): Promise<SuggestionsResult> {
  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Clé SUPABASE_SERVICE_ROLE_KEY absente." };

  const aujourdhui = todayIso();
  if (!force) {
    const { data } = await admin.from("daily_suggestions").select("id").eq("for_date", aujourdhui).maybeSingle();
    if (data) return { ok: true };
  }

  const [plan, { data: insight }] = await Promise.all([
    chargerPlan(admin),
    admin.from("pipeline_insights").select("headline").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (plan.affaires.length === 0) return { ok: false, error: "Aucune affaire à traiter aujourd'hui." };

  const instantane = {
    date: aujourdhui,
    objectif: insight?.headline ?? null,
    relances_leads_dues: plan.relances.length,
    affaires: plan.affaires.slice(0, 30).map((a) => ({
      cle: a.cle,
      nom: a.nom,
      etape: a.etapeLibelle,
      montant: a.montant,
      a_faire: a.action,
      aussi: a.aussi,
      retard_jours: a.retard || undefined,
    })),
  };

  try {
    const model = "claude-haiku-4-5";
    const response = await anthropicClient().messages.parse({
      model,
      max_tokens: 3000,
      system: CONSIGNES,
      output_config: { format: zodOutputFormat(Annotations) },
      messages: [{ role: "user", content: JSON.stringify(instantane) }],
    });
    const sortie = response.parsed_output;
    if (!sortie) return { ok: false, error: "Le modèle n'a pas renvoyé d'annotations exploitables." };

    const cles = new Set(plan.affaires.map((a) => a.cle));
    const { error } = await admin.from("daily_suggestions").upsert(
      {
        for_date: aujourdhui,
        focus: sortie.cap,
        items: sortie.gestes.filter((g) => cles.has(g.cle)),
        model,
      },
      { onConflict: "for_date" },
    );
    if (error) return { ok: false, error: error.message };
  } catch (caught) {
    return { ok: false, error: describeAnthropicError(caught) };
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Coche une ligne du plan pour aujourd'hui (ou la décoche). Pour une affaire,
 * c'est `faireAvancer` qui enregistre aussi la suite ; ceci ne fait que
 * sortir la ligne du plan de la personne.
 */
export async function cocherItem(cle: string, fait: boolean): Promise<SuggestionsResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const jour = todayIso();
  const { error } = fait
    ? await supabase.from("suggestion_done").upsert({ suggestion_date: jour, item_key: cle, user_id: profile.id })
    : await supabase.from("suggestion_done").delete().eq("suggestion_date", jour).eq("item_key", cle).eq("user_id", profile.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/leads");
  return { ok: true };
}

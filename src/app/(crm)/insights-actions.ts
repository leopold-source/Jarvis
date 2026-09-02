"use server";

import { revalidatePath } from "next/cache";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { DEAL_STAGE, DEAL_STAGE_ORDER, LEAD_STATUS } from "@/lib/constants";
import type { DealStage, LeadStatus } from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import {
  MISSING_KEY_ERROR,
  anthropicClient,
  anthropicKey,
  describeAnthropicError,
} from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";

/**
 * Analyse du pipeline par Claude.
 *
 * On agrège d'abord la donnée en un instantané compact — jamais les fiches
 * brutes — puis le modèle en tire trois axes d'amélioration classés. Seul le
 * premier remonte sur le tableau de bord ; le détail et le raisonnement sont
 * derrière le « i », pour ne pas encombrer l'accueil.
 */

const Priority = z.object({
  title: z.string().describe("L'axe, en une phrase impérative et courte"),
  observation: z.string().describe("Le constat chiffré tiré de l'instantané"),
  action: z.string().describe("Ce qu'il faut faire concrètement"),
  target: z.string().describe("Le résultat visé, chiffré et daté"),
  severity: z.enum(["critique", "important", "surveiller"]),
});

const Analysis = z.object({
  headline: z.string().describe("Le focus prioritaire, une phrase de moins de 90 caractères"),
  horizon_days: z.number().int().min(7).max(90).describe("Durée sur laquelle tenir ce focus"),
  priorities: z.array(Priority).length(3),
  reasoning: z
    .string()
    .describe("Pourquoi ce classement : quelles données ont pesé, et ce qui a été écarté"),
});

export type PipelinePriority = z.infer<typeof Priority>;
export type PipelineAnalysis = z.infer<typeof Analysis>;

export type InsightResult = { ok: true } | { ok: false; error: string };

const SYSTEM_PROMPT = `Tu es directeur commercial et tu relis le pipeline d'une agence
d'intégration d'IA en B2B. Son offre principale est de la formation et de
l'intégration IA vendue à des PME industrielles et des bureaux d'études.

On te donne un instantané chiffré : répartition des affaires par étape, âge moyen
dans chaque étape, taux de conversion, leads par statut, relances en retard.

S'y ajoute, quand elle existe, la matière tirée des rendez-vous eux-mêmes :
objections récurrentes, freins observés, signaux d'achat, engagement constaté,
montant médian évoqué. Ces champs disent *pourquoi* les chiffres sont ce
qu'ils sont — croise-les systématiquement avec les compteurs plutôt que de les
traiter à part.

Tu produis trois axes d'amélioration, classés du plus urgent au moins urgent.

Exigences :
- Appuie chaque constat sur un chiffre de l'instantané. Pas de conseil générique.
- Quand une objection ou un frein revient dans plusieurs rendez-vous, nomme-le et
  compte-le : c'est le levier le plus actionnable dont tu disposes.
- Un axe doit être actionnable cette semaine, pas une refonte de stratégie.
- La cible doit être chiffrée et datée (« passer le no show de 43 % à 25 % en 3 semaines »).
- Le titre du premier axe alimente un encart d'une ligne : sois direct
  (« Travailler le no show pendant 3 semaines »).
- Si une étape concentre visiblement le problème, dis-le franchement plutôt que
  de répartir les efforts.
- Dans « reasoning », explique le classement : ce qui t'a fait mettre cet axe en
  premier, et ce que tu as écarté volontairement.`;

/** Instantané agrégé, envoyé au modèle à la place des données brutes. */
async function buildSnapshot() {
  const supabase = await createClient();
  const today = new Date();

  const [{ data: deals }, { data: leads }, { data: calls }] = await Promise.all([
    supabase.from("deals").select("stage, amount, created_at, stage_changed_at, won_at, lost_at"),
    supabase.from("leads").select("status, follow_up_on, created_at"),
    // Les fiches de call apportent le « pourquoi » que les compteurs ne
    // donnent pas : un taux de no-show ne dit pas ce qui coince, la
    // récurrence des objections si.
    supabase
      .from("call_records")
      .select("kind, occurred_on, insights")
      .not("insights", "is", null)
      .order("occurred_on", { ascending: false })
      .limit(60),
  ]);

  const allDeals = deals ?? [];
  const allLeads = leads ?? [];

  const ageInDays = (iso: string) =>
    Math.max(0, Math.round((today.getTime() - new Date(iso).getTime()) / 86_400_000));

  const byStage = DEAL_STAGE_ORDER.map((stage) => {
    const rows = allDeals.filter((deal) => deal.stage === stage);
    const ages = rows.map((deal) => ageInDays(deal.stage_changed_at));
    return {
      etape: DEAL_STAGE[stage as DealStage].label,
      affaires: rows.length,
      montant_total: rows.reduce((sum, deal) => sum + (deal.amount ?? 0), 0),
      age_moyen_jours: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
      age_max_jours: ages.length ? Math.max(...ages) : 0,
    };
  });

  const won = allDeals.filter((deal) => deal.stage === "gagne").length;
  const lost = allDeals.filter((deal) => ["perdu", "non_qualifie"].includes(deal.stage)).length;
  const noShow = allDeals.filter((deal) => deal.stage === "no_show").length;
  const todayIso = today.toISOString().slice(0, 10);

  const leadsByStatus = Object.keys(LEAD_STATUS).map((status) => ({
    statut: LEAD_STATUS[status as LeadStatus].label,
    nombre: allLeads.filter((lead) => lead.status === status).length,
  }));

  // Agrégation des fiches : on compte les récurrences plutôt que de recopier
  // les fiches une à une, sinon l'instantané enflerait sans rien apprendre.
  const rows = (calls ?? []) as Array<{ kind: string | null; insights: Record<string, unknown> }>;
  const tally = (field: string) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const values = row.insights?.[field];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const key = String(value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([valeur, nombre]) => ({ valeur, nombre }));
  };

  const engagements = rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row.insights?.engagement ?? "inconnu");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

  const montants = rows
    .map((row) => Number(row.insights?.montant_evoque))
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    date: todayIso,
    affaires_total: allDeals.length,
    calls_depouilles: rows.length,
    objections_recurrentes: tally("objections"),
    blocages_recurrents: tally("blocages"),
    signaux_achat_frequents: tally("signaux_achat"),
    engagement_observe: engagements,
    montant_evoque_median:
      montants.length > 0 ? montants.sort((a, b) => a - b)[Math.floor(montants.length / 2)] : null,
    par_etape: byStage,
    taux_conversion_pct: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    part_no_show_pct: allDeals.length ? Math.round((noShow / allDeals.length) * 100) : 0,
    leads_total: allLeads.length,
    leads_par_statut: leadsByStatus,
    relances_en_retard: allLeads.filter((lead) => lead.follow_up_on && lead.follow_up_on < todayIso).length,
    relances_du_jour: allLeads.filter((lead) => lead.follow_up_on === todayIso).length,
    leads_sans_relance: allLeads.filter((lead) => !lead.follow_up_on).length,
  };
}

export async function analysePipeline(): Promise<InsightResult> {
  const profile = await requireStaff();

  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };

  const snapshot = await buildSnapshot();
  if (snapshot.affaires_total === 0) {
    return { ok: false, error: "Pas encore assez d'affaires pour tirer une analyse." };
  }

  try {
    const client = anthropicClient();
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(Analysis) },
      messages: [
        {
          role: "user",
          content: `Instantané du pipeline :\n${JSON.stringify(snapshot, null, 1)}`,
        },
      ],
    });

    const analysis = response.parsed_output;
    if (!analysis) return { ok: false, error: "Le modèle n'a pas renvoyé d'analyse exploitable." };

    const supabase = await createClient();
    const { error } = await supabase.from("pipeline_insights").insert({
      headline: analysis.headline,
      horizon_days: analysis.horizon_days,
      priorities: analysis.priorities,
      reasoning: analysis.reasoning,
      snapshot,
      created_by: profile.id,
    });

    if (error) return { ok: false, error: error.message };
  } catch (caught) {
    return { ok: false, error: describeAnthropicError(caught) };
  }

  revalidatePath("/");
  return { ok: true };
}

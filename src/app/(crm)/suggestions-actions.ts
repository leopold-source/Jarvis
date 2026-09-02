"use server";

import { revalidatePath } from "next/cache";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { DEAL_STAGE, LEAD_STATUS } from "@/lib/constants";
import type { DailySuggestion, DealStage, LeadStatus } from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import { MISSING_KEY_ERROR, anthropicClient, anthropicKey, describeAnthropicError } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Suggestions du jour.
 *
 * Volontairement séparée de l'analyse du pipeline : celle-ci raisonne sur des
 * tendances et coûte cher, celle-là ne fait que traduire l'état du CRM en
 * gestes concrets — « rappeler untel », « trancher telle propale ». Un modèle
 * rapide suffit, à condition de lui mâcher le travail : l'instantané est
 * plafonné et déjà trié, le modèle ne fait que choisir, formuler et ordonner.
 *
 * Le cadrage vient de la dernière analyse du pipeline, transmise en consigne :
 * les gestes du jour restent alignés sur le chantier de fond plutôt que de
 * partir dans une autre direction chaque matin.
 */

/** Assez pour couvrir une journée d'appels, assez peu pour rester bon marché. */
const MAX_PER_CATEGORY = 12;
const MAX_ITEMS = 8;

const SuggestionItem = z.object({
  key: z.string().describe("Identifiant stable : type + identifiant de la fiche, ex. lead:uuid"),
  title: z.string().describe("L'action, à l'impératif, moins de 70 caractères"),
  detail: z.string().describe("Le pourquoi, en une phrase, avec le chiffre qui le justifie"),
  kind: z.enum(["appel", "relance", "decision", "administratif"]),
  urgency: z.enum(["haute", "normale"]),
  href: z.string().describe("Lien interne vers la fiche, ex. /leads?lead=uuid ou /affaires?affaire=uuid"),
});

const DailyPlan = z.object({
  focus: z.string().describe("La ligne directrice du jour, moins de 80 caractères"),
  items: z.array(SuggestionItem).min(3).max(MAX_ITEMS),
});

export type SuggestionItemType = z.infer<typeof SuggestionItem>;

export type SuggestionsResult = { ok: true } | { ok: false; error: string };

const SYSTEM_PROMPT = `Tu prépares la journée d'un commercial en B2B, dans une agence
qui vend de la formation et de l'intégration IA à des PME industrielles.

On te donne l'état du CRM ce matin : relances dues, affaires figées, leads à
rappeler. Chaque entrée porte déjà son identifiant et son lien.

Tu renvoies une liste courte d'actions, de la plus urgente à la moins urgente.

Règles :
- Une action = une fiche précise, nommée. Jamais « relancer les leads en retard »,
  toujours « Rappeler Paul Cairola (Cet Bâtiment) ».
- Reprends l'identifiant et le lien exacts fournis dans l'instantané. N'invente
  ni nom, ni identifiant, ni lien.
- Le détail donne le chiffre qui justifie l'action : jours de retard, âge dans
  l'étape, nombre de tentatives.
- Priorise ce qui se périme : une relance datée d'hier passe avant un lead
  jamais rappelé.
- Si un axe de travail prioritaire t'est donné, ordonne la liste pour le servir.
- Pas de remplissage : mieux vaut trois actions justes que huit approximatives.`;

/** Instantané du jour : trié et plafonné avant d'atteindre le modèle. */
async function buildDailySnapshot() {
  const admin = createAdminClient();
  const supabase = admin ?? (await createClient());
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: leads }, { data: deals }, { data: insight }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, full_name, company_name, status, follow_up_on, comment")
      .is("converted_deal_id", null)
      .order("follow_up_on", { ascending: true, nullsFirst: false })
      .limit(400),
    supabase
      .from("deals")
      .select("id, name, stage, amount, stage_changed_at, next_step, next_step_on")
      .not("stage", "in", "(gagne,perdu,non_qualifie)")
      .order("stage_changed_at", { ascending: true })
      .limit(60),
    supabase
      .from("pipeline_insights")
      .select("headline, horizon_days")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const allLeads = leads ?? [];
  const days = (iso: string) =>
    Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);

  const relances = allLeads
    .filter((lead) => lead.follow_up_on && lead.follow_up_on <= today)
    .slice(0, MAX_PER_CATEGORY)
    .map((lead) => ({
      id: `lead:${lead.id}`,
      lien: `/leads?lead=${lead.id}`,
      nom: lead.full_name,
      entreprise: lead.company_name,
      statut: LEAD_STATUS[lead.status as LeadStatus]?.label,
      relance_prevue: lead.follow_up_on,
      retard_jours: lead.follow_up_on === today ? 0 : days(lead.follow_up_on!),
      note: lead.comment?.slice(0, 120) ?? null,
    }));

  // Les NRP et « à recontacter » sans date : le vivier qu'on oublie.
  const aRappeler = allLeads
    .filter(
      (lead) =>
        !lead.follow_up_on &&
        ["nrp", "nrp2", "nrp3", "a_recontacter"].includes(lead.status),
    )
    .slice(0, MAX_PER_CATEGORY)
    .map((lead) => ({
      id: `lead:${lead.id}`,
      lien: `/leads?lead=${lead.id}`,
      nom: lead.full_name,
      entreprise: lead.company_name,
      statut: LEAD_STATUS[lead.status as LeadStatus]?.label,
      note: lead.comment?.slice(0, 120) ?? null,
    }));

  const affairesFigees = (deals ?? [])
    .map((deal) => ({
      id: `deal:${deal.id}`,
      lien: `/affaires?affaire=${deal.id}`,
      nom: deal.name,
      etape: DEAL_STAGE[deal.stage as DealStage]?.label,
      jours_dans_etape: days(deal.stage_changed_at),
      montant: deal.amount,
      prochaine_etape: deal.next_step,
      prochaine_etape_le: deal.next_step_on,
    }))
    .filter((deal) => deal.jours_dans_etape >= 7)
    .slice(0, MAX_PER_CATEGORY);

  return {
    date: today,
    axe_prioritaire: insight?.headline ?? null,
    relances_dues: relances,
    leads_a_rappeler: aRappeler,
    affaires_figees: affairesFigees,
  };
}

export async function generateSuggestions(force = false): Promise<SuggestionsResult> {
  await requireStaff();
  return runSuggestions(force);
}

/**
 * Génération proprement dite, sans contrôle de session : appelée aussi bien
 * depuis l'interface que depuis le cron, qui n'a pas d'utilisateur connecté.
 */
export async function runSuggestions(force = false): Promise<SuggestionsResult> {
  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Clé SUPABASE_SERVICE_ROLE_KEY absente." };

  const today = new Date().toISOString().slice(0, 10);

  if (!force) {
    const { data: existing } = await admin
      .from("daily_suggestions")
      .select("id")
      .eq("for_date", today)
      .maybeSingle();
    if (existing) return { ok: true };
  }

  const snapshot = await buildDailySnapshot();
  const total =
    snapshot.relances_dues.length +
    snapshot.leads_a_rappeler.length +
    snapshot.affaires_figees.length;
  if (total === 0) return { ok: false, error: "Rien à suggérer : aucune action en attente." };

  try {
    // Haiku : l'instantané est déjà trié et plafonné, le modèle n'a plus qu'à
    // choisir et formuler. Un modèle de raisonnement coûterait dix fois plus
    // pour un résultat que l'utilisateur ne distinguerait pas.
    const model = "claude-haiku-4-5";
    const response = await anthropicClient().messages.parse({
      model,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(DailyPlan) },
      messages: [{ role: "user", content: `État du CRM ce matin :\n${JSON.stringify(snapshot)}` }],
    });

    const plan = response.parsed_output;
    if (!plan) return { ok: false, error: "Le modèle n'a pas renvoyé de plan exploitable." };

    const { error } = await admin.from("daily_suggestions").upsert(
      { for_date: today, focus: plan.focus, items: plan.items, model },
      { onConflict: "for_date" },
    );
    if (error) return { ok: false, error: error.message };
  } catch (caught) {
    return { ok: false, error: describeAnthropicError(caught) };
  }

  revalidatePath("/");
  return { ok: true };
}

/** Coche ou décoche une suggestion, pour le seul utilisateur courant. */
export async function toggleSuggestion(itemKey: string, done: boolean): Promise<SuggestionsResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { error } = done
    ? await supabase
        .from("suggestion_done")
        .upsert({ suggestion_date: today, item_key: itemKey, user_id: profile.id })
    : await supabase
        .from("suggestion_done")
        .delete()
        .eq("suggestion_date", today)
        .eq("item_key", itemKey)
        .eq("user_id", profile.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type SuggestionsView = { row: DailySuggestion | null; done: string[] };

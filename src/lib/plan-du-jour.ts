import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEAL_STAGE, LEAD_STATUS } from "@/lib/constants";
import type { Database, DealStage, LeadStatus } from "@/lib/database.types";
import { construirePlan, type Plan } from "@/lib/plan-logique";
import { todayIso } from "@/lib/utils";

/**
 * Le plan du jour, lu dans le CRM.
 *
 * Une seule fonction pour l'accueil, le verrou de la prospection et le récap
 * du matin : les trois disent toujours la même chose. Les gestes conseillés
 * par l'IA s'y ajoutent s'ils existent pour aujourd'hui ; le plan n'en dépend
 * pas.
 */

export type PlanComplet = Plan & {
  /** Le cap du jour, écrit par l'IA à partir de l'objectif. */
  cap: string | null;
  /** Le geste conseillé par l'IA, par clé d'item (« deal:… »). */
  gestes: Record<string, string>;
  capLe: string | null;
};

export async function chargerPlan(
  client: SupabaseClient<Database>,
  options: { userId?: string | null } = {},
): Promise<PlanComplet> {
  const aujourdhui = todayIso();

  const [deals, sante, devis, recaps, leads, coches, ia] = await Promise.all([
    client
      .from("deals")
      .select("id, name, stage, amount, owner_id, next_step, next_step_on")
      .not("stage", "in", "(gagne,perdu,non_qualifie)"),
    client.from("deal_health").select("deal_id, sante, jours_dans_etape"),
    client
      .from("devis_pennylane")
      .select("deal_id, numero, statut, echeance_le")
      .in("statut", ["en_attente", "expire"])
      .not("deal_id", "is", null),
    client.from("deal_recaps").select("deal_id").eq("status", "pret"),
    client
      .from("leads")
      .select("id, full_name, company_name, status, follow_up_on, owner_id, nrp_count")
      .is("converted_deal_id", null)
      .not("status", "in", "(call_pris,non_qualifie,pas_interesse)")
      .not("follow_up_on", "is", null)
      .lte("follow_up_on", aujourdhui)
      .limit(1000),
    options.userId
      ? client.from("suggestion_done").select("item_key").eq("suggestion_date", aujourdhui).eq("user_id", options.userId)
      : Promise.resolve({ data: [] as Array<{ item_key: string }> }),
    client.from("daily_suggestions").select("focus, items, created_at").eq("for_date", aujourdhui).maybeSingle(),
  ]);

  const santeParId = new Map((sante.data ?? []).map((s) => [s.deal_id, s]));

  const plan = construirePlan({
    aujourdhui,
    affaires: (deals.data ?? []).map((d) => ({
      id: d.id,
      nom: d.name,
      etape: d.stage as DealStage,
      etapeLibelle: DEAL_STAGE[d.stage as DealStage].label,
      montant: d.amount,
      ownerId: d.owner_id,
      nextStep: d.next_step,
      nextStepOn: d.next_step_on,
      dormante: santeParId.get(d.id)?.sante === "dormant",
      joursDansEtape: santeParId.get(d.id)?.jours_dans_etape ?? null,
    })),
    devis: (devis.data ?? []).map((x) => ({
      dealId: x.deal_id!,
      numero: x.numero,
      statut: x.statut,
      echeanceLe: x.echeance_le,
    })),
    recapsPrets: (recaps.data ?? []).map((r) => r.deal_id),
    leads: (leads.data ?? []).map((l) => ({
      id: l.id,
      nom: l.full_name ?? "Sans nom",
      entreprise: l.company_name,
      statutLibelle: LEAD_STATUS[l.status as LeadStatus]?.label ?? l.status,
      followUpOn: l.follow_up_on!,
      ownerId: l.owner_id,
      nrp: l.nrp_count ?? 0,
    })),
    coches: new Set((coches.data ?? []).map((c) => c.item_key)),
  });

  // Les gestes de l'IA : un tableau { cle, geste } ; l'ancien format est ignoré.
  const gestes: Record<string, string> = {};
  for (const item of (ia.data?.items ?? []) as Array<{ cle?: string; geste?: string }>) {
    if (item?.cle && item.geste) gestes[item.cle] = item.geste;
  }

  return { ...plan, cap: ia.data?.focus ?? null, gestes, capLe: ia.data?.created_at ?? null };
}

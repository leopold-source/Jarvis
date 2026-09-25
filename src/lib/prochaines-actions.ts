import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEAL_STAGE, LEAD_STATUS } from "@/lib/constants";
import type { Database, DealStage, LeadStatus } from "@/lib/database.types";
import { aRelancer } from "@/lib/devis-logique";
import { classerEcheance, joursDeRetard, nomProchainOuvre, prochainOuvre, type Echeance } from "@/lib/echeances";
import { todayIso } from "@/lib/utils";

/**
 * Ce qui ne doit pas filer : les prochaines étapes des affaires, les devis à
 * relancer, les récaps prêts, les relances de leads.
 *
 * Une seule lecture pour deux usages — la carte de l'accueil et le récap du
 * matin — pour qu'ils disent toujours la même chose.
 */

const OUVERTES_EXCLUES = "(gagne,perdu,non_qualifie)";
/** Les étapes où une affaire sans prochaine étape datée est une affaire qu'on oublie. */
const CHAUDES: DealStage[] = ["r1", "r2", "propale_envoyee"];

export type ActionAffaire = {
  dealId: string;
  nom: string;
  etape: string;
  action: string | null;
  le: string;
  echeance: Echeance;
  retard: number;
  ownerId: string | null;
};

export type Radar = {
  aujourdhui: string;
  prochain: string;
  nomProchain: string;
  affaires: ActionAffaire[];
  devis: Array<{ dealId: string; nom: string; numero: string | null; echeance: string | null; expire: boolean; ownerId: string | null }>;
  recaps: Array<{ dealId: string; nom: string; ownerId: string | null }>;
  sansSuite: Array<{ dealId: string; nom: string; etape: string; ownerId: string | null }>;
  /** Les tâches d'équipe qui demandent un geste : en retard, du jour, prioritaires ou bloquées. */
  taches: Array<{
    id: string;
    titre: string;
    categorie: string | null;
    le: string | null;
    echeance: Echeance | null;
    prio: boolean;
    probleme: boolean;
    assignees: string[];
  }>;
  relances: Array<{
    leadId: string;
    nom: string;
    entreprise: string | null;
    statut: string;
    le: string;
    retard: number;
    ownerId: string | null;
  }>;
};

export async function chargerRadar(client: SupabaseClient<Database>): Promise<Radar> {
  const aujourdhui = todayIso();
  const prochain = prochainOuvre(aujourdhui);

  const [{ data: deals }, { data: devis }, { data: recaps }, { data: leads }, { data: todos }] = await Promise.all([
    client
      .from("deals")
      .select("id, name, stage, next_step, next_step_on, owner_id")
      .not("stage", "in", OUVERTES_EXCLUES),
    client
      .from("devis_pennylane")
      .select("deal_id, numero, statut, echeance_le")
      .in("statut", ["en_attente", "expire"])
      .not("deal_id", "is", null),
    client.from("deal_recaps").select("deal_id").eq("status", "pret"),
    client
      .from("leads")
      .select("id, full_name, company_name, status, follow_up_on, owner_id")
      .is("converted_deal_id", null)
      .not("status", "in", "(call_pris,non_qualifie,pas_interesse)")
      .not("follow_up_on", "is", null)
      .lte("follow_up_on", aujourdhui)
      .order("follow_up_on")
      .limit(300),
    client
      .from("todos")
      .select("id, titre, categorie, statut, priorite, due_on, assignee_ids")
      .neq("statut", "fait")
      .limit(500),
  ]);

  const parId = new Map((deals ?? []).map((d) => [d.id, d]));

  const affaires: ActionAffaire[] = [];
  const sansSuite: Radar["sansSuite"] = [];
  for (const d of deals ?? []) {
    const echeance = classerEcheance(d.next_step_on, aujourdhui);
    if (echeance) {
      affaires.push({
        dealId: d.id,
        nom: d.name,
        etape: DEAL_STAGE[d.stage].label,
        action: d.next_step,
        le: d.next_step_on!,
        echeance,
        retard: echeance === "retard" ? joursDeRetard(d.next_step_on!, aujourdhui) : 0,
        ownerId: d.owner_id,
      });
    } else if (!d.next_step_on && CHAUDES.includes(d.stage)) {
      sansSuite.push({ dealId: d.id, nom: d.name, etape: DEAL_STAGE[d.stage].label, ownerId: d.owner_id });
    }
  }
  affaires.sort((a, b) => (a.le < b.le ? -1 : a.le > b.le ? 1 : a.nom.localeCompare(b.nom)));

  const devisARelancer: Radar["devis"] = [];
  for (const x of devis ?? []) {
    const affaire = parId.get(x.deal_id!);
    if (!affaire) continue;
    const bientot = x.statut === "en_attente" && x.echeance_le && x.echeance_le <= prochain;
    if (!aRelancer(x, aujourdhui) && !bientot) continue;
    devisARelancer.push({
      dealId: affaire.id,
      nom: affaire.name,
      numero: x.numero,
      echeance: x.echeance_le,
      expire: x.statut === "expire",
      ownerId: affaire.owner_id,
    });
  }

  return {
    aujourdhui,
    prochain,
    nomProchain: nomProchainOuvre(aujourdhui),
    affaires,
    devis: devisARelancer,
    recaps: (recaps ?? []).flatMap((r) => {
      const affaire = parId.get(r.deal_id);
      return affaire ? [{ dealId: affaire.id, nom: affaire.name, ownerId: affaire.owner_id }] : [];
    }),
    sansSuite,
    taches: (todos ?? [])
      .map((t) => ({
        id: t.id,
        titre: t.titre,
        categorie: t.categorie,
        le: t.due_on,
        echeance: classerEcheance(t.due_on, aujourdhui),
        // Priorité 1 : celle qu'on ne laisse pas glisser.
        prio: t.priorite === 1,
        probleme: t.statut === "probleme",
        assignees: t.assignee_ids,
      }))
      .filter((t) => t.echeance || t.prio || t.probleme)
      .sort((a, b) => {
        const rang = (t: typeof a) => (t.probleme ? 0 : t.echeance === "retard" ? 1 : t.echeance === "jour" ? 2 : t.prio ? 3 : 4);
        return rang(a) - rang(b) || (a.le ?? "9999").localeCompare(b.le ?? "9999");
      }),
    relances: (leads ?? []).map((l) => ({
      leadId: l.id,
      nom: l.full_name ?? "Sans nom",
      entreprise: l.company_name,
      statut: LEAD_STATUS[l.status as LeadStatus]?.label ?? l.status,
      le: l.follow_up_on!,
      retard: joursDeRetard(l.follow_up_on!, aujourdhui),
      ownerId: l.owner_id,
    })),
  };
}

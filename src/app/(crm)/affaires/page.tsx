import { after } from "next/server";

import { PageHeader } from "@/components/layout/page-header";
import { DealBoard } from "@/components/crm/deal-board";
import { CallInbox } from "@/components/crm/call-inbox";
import { requireStaff } from "@/lib/auth";
import type { CallInbox as CallInboxRow } from "@/lib/database.types";
import { synchroniserDevis } from "@/lib/devis-pennylane";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Affaires" };

/*
  Une minute pour les actions de cette page.

  Le passage en R2 lance, après la réponse, la synchro Claap puis la rédaction
  du récap : une vingtaine de secondes pour un call d'une heure. La durée par
  défaut d'une fonction suffirait souvent, pas toujours.
*/
export const maxDuration = 60;

export default async function DealsPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: deals }, { data: companies }, { data: contacts }, { data: members }, { data: projects }] =
    await Promise.all([
      // Colonnes nommées : les notes et la synthèse se chargent à l'ouverture
      // d'une affaire, pas avec le tableau entier.
      supabase
        .from("deals")
        .select(
          "id, name, company_id, contact_id, stage, amount, probability, owner_id, expected_close_on, next_step, next_step_on, description, lost_reason, source_lead_id, position, stage_changed_at, won_at, lost_at, created_by, created_at, updated_at",
        )
        .order("position", { ascending: true }),
      supabase.from("companies").select("id, name, sector, region").order("name"),
      supabase.from("contacts").select("id, full_name, email, company_id").order("full_name"),
      supabase.from("profiles").select("id, full_name, email, role").neq("role", "client"),
      supabase.from("projects").select("id, deal_id, name").order("name"),
    ]);

  // Pennylane ne prévient pas quand un devis change : ouvrir les affaires est
  // l'occasion de relire. Après la réponse, et pas plus d'une fois toutes les
  // dix minutes — la page n'attend jamais Pennylane.
  after(() => synchroniserDevis());

  const [{ data: pendingCalls }, { data: recaps }, { data: devis }] = await Promise.all([
    // Sans le transcript : la file n'affiche que titre, date et participants.
    supabase
      .from("call_inbox")
      .select(
        "id, provider, provider_call_id, title, url, occurred_on, participants, suggested_company, folder_title, summary, started_at, ended_at, status, resolved_deal_id, resolved_project_id, resolved_by, resolved_at, created_at",
      )
      .eq("status", "en_attente")
      .order("occurred_on", { ascending: false }),
    supabase
      .from("deal_recaps")
      .select("id, deal_id, status, updated_at")
      .in("status", ["en_attente_call", "redaction", "pret", "echec"])
      .order("requested_at", { ascending: false }),
    supabase
      .from("devis_pennylane")
      .select("deal_id, statut, montant_ht, echeance_le, emis_le")
      .not("deal_id", "is", null),
  ]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <PageHeader
        title="Affaires"
        description="Le pipeline commercial. Glissez une carte pour la faire avancer ; une affaire gagnée crée automatiquement son projet."
      />
      <CallInbox
        pending={(pendingCalls ?? []) as CallInboxRow[]}
        deals={(deals ?? []).map((deal) => ({ id: deal.id, name: deal.name }))}
        projects={(projects ?? []).map((project) => ({ id: project.id, name: project.name }))}
      />

      <DealBoard
        deals={deals ?? []}
        companies={companies ?? []}
        contacts={contacts ?? []}
        members={members ?? []}
        projects={projects ?? []}
        recaps={recaps ?? []}
        devis={devis ?? []}
        isAdmin={profile.role === "admin"}
      />
    </div>
  );
}

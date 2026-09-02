import { PageHeader } from "@/components/layout/page-header";
import { DealBoard } from "@/components/crm/deal-board";
import { CallInbox } from "@/components/crm/call-inbox";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Affaires" };

export default async function DealsPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: deals }, { data: companies }, { data: contacts }, { data: members }, { data: projects }] =
    await Promise.all([
      supabase.from("deals").select("*").order("position", { ascending: true }),
      supabase.from("companies").select("id, name, sector, region").order("name"),
      supabase.from("contacts").select("id, full_name, email, company_id").order("full_name"),
      supabase.from("profiles").select("id, full_name, email, role").neq("role", "client"),
      supabase.from("projects").select("id, deal_id, name").order("name"),
    ]);

  const { data: pendingCalls } = await supabase
    .from("call_inbox")
    .select("*")
    .eq("status", "en_attente")
    .order("occurred_on", { ascending: false });

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <PageHeader
        title="Affaires"
        description="Le pipeline commercial. Glissez une carte pour la faire avancer ; une affaire gagnée crée automatiquement son projet."
      />
      <CallInbox
        pending={pendingCalls ?? []}
        deals={(deals ?? []).map((deal) => ({ id: deal.id, name: deal.name }))}
        projects={(projects ?? []).map((project) => ({ id: project.id, name: project.name }))}
      />

      <DealBoard
        deals={deals ?? []}
        companies={companies ?? []}
        contacts={contacts ?? []}
        members={members ?? []}
        projects={projects ?? []}
        isAdmin={profile.role === "admin"}
      />
    </div>
  );
}

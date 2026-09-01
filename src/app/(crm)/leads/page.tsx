import { PageHeader } from "@/components/layout/page-header";
import { LeadsWorkspace } from "@/components/crm/leads-workspace";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Leads"
        description="La base de prospection amont. Dès qu'un lead accepte un rendez-vous, convertissez-le : contact, entreprise et affaire sont créés d'un coup."
      />
      <LeadsWorkspace leads={leads ?? []} isAdmin={profile.role === "admin"} />
    </div>
  );
}

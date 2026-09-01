import { PageHeader } from "@/components/layout/page-header";
import { CompaniesTable } from "@/components/crm/companies-table";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Entreprises" };

export default async function CompaniesPage() {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: companies }, { data: contacts }, { data: deals }, { data: projects }] =
    await Promise.all([
      supabase.from("companies").select("*").order("name"),
      supabase.from("contacts").select("id, full_name, email, phone, job_title, company_id"),
      supabase.from("deals").select("id, name, stage, amount, company_id"),
      supabase.from("projects").select("id, name, status, company_id"),
    ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Entreprises"
        description="Les comptes clients et prospects, avec leurs contacts, affaires et projets."
      />
      <CompaniesTable
        companies={companies ?? []}
        contacts={contacts ?? []}
        deals={deals ?? []}
        projects={projects ?? []}
      />
    </div>
  );
}

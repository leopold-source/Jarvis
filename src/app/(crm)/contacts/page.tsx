import { PageHeader } from "@/components/layout/page-header";
import { ContactsTable } from "@/components/crm/contacts-table";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: contacts }, { data: companies }, { data: deals }] = await Promise.all([
    supabase.from("contacts").select("*").order("created_at", { ascending: false }),
    supabase.from("companies").select("id, name"),
    supabase.from("deals").select("id, name, stage, contact_id"),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Contacts"
        description="Les interlocuteurs qualifiés, créés automatiquement à la conversion d'un lead."
      />
      <ContactsTable contacts={contacts ?? []} companies={companies ?? []} deals={deals ?? []} />
    </div>
  );
}

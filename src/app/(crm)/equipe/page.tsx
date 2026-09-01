import { PageHeader } from "@/components/layout/page-header";
import { TeamManager } from "@/components/crm/team-manager";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Équipe & accès" };

export default async function TeamPage() {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const [{ data: profiles }, { data: companies }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("companies").select("id, name").order("name"),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Équipe & accès"
        description="Invitez vos collaborateurs et donnez à vos clients un accès en lecture seule à leurs projets."
      />
      <TeamManager
        profiles={profiles ?? []}
        companies={companies ?? []}
        currentUserId={admin.id}
        invitesEnabled={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
      />
    </div>
  );
}

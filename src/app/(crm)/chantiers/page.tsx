import { PageHeader } from "@/components/layout/page-header";
import { ChantiersBoard } from "@/components/crm/chantiers-board";
import { requireStaff } from "@/lib/auth";
import type { Chantier, Objectif } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Chantiers" };

/**
 * Les chantiers, c'est-à-dire la conduite de la boîte.
 *
 * Un cran au-dessus des affaires et des projets : ici on ne suit pas un client
 * mais un sujet que l'on a décidé de faire avancer, et le chiffre qui dit s'il
 * avance. Le quotidien n'y figure pas — il se gère ailleurs, et l'y faire
 * entrer aurait transformé cet écran en liste de courses.
 */
export default async function ChantiersPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: chantiers }, { data: objectifs }, { data: team }] = await Promise.all([
    supabase.from("chantiers").select("*").order("position", { ascending: true }),
    supabase.from("objectifs").select("*").order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, full_name, email").neq("role", "client"),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Chantiers"
        description="Les grands sujets qui font avancer la boîte, et le chiffre qui dit où ils en sont."
      />
      <ChantiersBoard
        chantiers={(chantiers ?? []) as Chantier[]}
        objectifs={(objectifs ?? []) as Objectif[]}
        team={team ?? []}
        currentUserId={profile.id}
      />
    </div>
  );
}

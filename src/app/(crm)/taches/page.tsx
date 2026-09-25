import { PageHeader } from "@/components/layout/page-header";
import { TachesWorkspace } from "@/components/crm/taches-workspace";
import { requireStaff } from "@/lib/auth";
import type { Todo } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tâches" };

/**
 * Les tâches du quotidien — le Sheet de l'équipe, dans l'application.
 *
 * À côté des chantiers et non dedans : un chantier porte un objectif chiffré,
 * une tâche est un geste. Même structure que le tableau d'origine — priorité,
 * tâche, catégorie, statut, qui, détails, quand, un commentaire par associé —
 * pour qu'on s'y retrouve sans réapprendre.
 */
export default async function TachesPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: taches }, { data: equipe }] = await Promise.all([
    supabase.from("todos").select("*").order("position", { ascending: true }).limit(2000),
    supabase.from("profiles").select("id, full_name, email").neq("role", "client").eq("is_active", true).order("created_at"),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <PageHeader
        title="Tâches"
        description="Ce que l'équipe se donne à faire au quotidien. Les grands sujets restent dans les chantiers."
      />
      <TachesWorkspace
        initiales={(taches ?? []) as Todo[]}
        membres={(equipe ?? []).map((m) => ({ id: m.id, nom: m.full_name ?? m.email }))}
        moi={profile.id}
      />
    </div>
  );
}

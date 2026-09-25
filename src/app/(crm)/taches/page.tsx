import { PageHeader } from "@/components/layout/page-header";
import { TachesWorkspace } from "@/components/crm/taches-workspace";
import { requireStaff } from "@/lib/auth";
import type { Todo } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tâches" };

/**
 * Les tâches du quotidien — ce que l'équipe se donne à faire.
 *
 * À côté des chantiers et non dedans : un chantier porte un objectif chiffré,
 * une tâche est un geste. Les mêler aurait obligé à inventer un chantier
 * « Webapp » pour ranger un favicon. Ici, une ligne, une personne, une date.
 */
export default async function TachesPage() {
  const profile = await requireStaff();
  const supabase = await createClient();
  const depuis = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ data: ouvertes }, { data: faites }, { data: equipe }, { data: comptes }, { data: affaires }, { data: chantiers }] =
    await Promise.all([
      supabase.from("todos").select("*").neq("statut", "fait"),
      // Les tâches faites du dernier mois : assez pour retrouver, pas pour encombrer.
      supabase.from("todos").select("*").eq("statut", "fait").gte("done_at", depuis).order("done_at", { ascending: false }).limit(200),
      supabase.from("profiles").select("id, full_name, email").neq("role", "client").eq("is_active", true),
      supabase.from("todo_comments").select("todo_id"),
      supabase.from("deals").select("id, name").not("stage", "in", "(perdu,non_qualifie)").order("updated_at", { ascending: false }).limit(200),
      supabase.from("chantiers").select("id, title").neq("status", "termine").order("position"),
    ]);

  const commentaires: Record<string, number> = {};
  for (const c of comptes ?? []) commentaires[c.todo_id] = (commentaires[c.todo_id] ?? 0) + 1;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Tâches"
        description="Ce que l'équipe se donne à faire au quotidien. Les grands sujets restent dans les chantiers."
      />
      <TachesWorkspace
        initiales={[...(ouvertes ?? []), ...(faites ?? [])] as Todo[]}
        membres={(equipe ?? []).map((m) => ({ id: m.id, nom: m.full_name ?? m.email }))}
        moi={profile.id}
        commentaires={commentaires}
        affaires={(affaires ?? []).map((a) => ({ id: a.id, nom: a.name }))}
        chantiers={(chantiers ?? []).map((c) => ({ id: c.id, nom: c.title }))}
      />
    </div>
  );
}

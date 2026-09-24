import type { SupabaseClient } from "@supabase/supabase-js";

import { PROJECT_TEMPLATE } from "@/lib/constants";
import type { Database } from "@/lib/database.types";

/**
 * Ajoute le squelette de tâches et de jalons au projet issu d'une affaire
 * gagnée. Sans effet si le projet a déjà des tâches.
 *
 * Le client est passé en paramètre : l'affaire se gagne à la main, depuis le
 * tableau, mais aussi toute seule quand Pennylane dit le devis accepté — et
 * cette synchronisation-là tourne sans session.
 */
export async function amorcerProjet(
  supabase: SupabaseClient<Database>,
  dealId: string,
): Promise<string | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, start_on, owner_id")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!project) return null;

  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  if ((count ?? 0) > 0) return project.id;

  const start = project.start_on ? new Date(project.start_on) : new Date();

  const rows = PROJECT_TEMPLATE.map((step, index) => ({
    project_id: project.id,
    title: step.title,
    kind: step.kind,
    is_client_visible: step.clientVisible ?? false,
    position: (index + 1) * 100,
    assignee_id: project.owner_id,
    due_on: new Date(start.getTime() + step.offsetDays * 86_400_000).toISOString().slice(0, 10),
  }));

  await supabase.from("tasks").insert(rows);
  return project.id;
}

"use server";

import { revalidatePath } from "next/cache";

import { PROJECT_TEMPLATE } from "@/lib/constants";
import type { DealStage } from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Déplace une affaire dans le Kanban.
 *
 * Le passage en « gagné » déclenche côté base la création du projet ; on
 * l'amorce ensuite avec un squelette de jalons et de tâches pour que le chef de
 * projet ne parte pas d'une page blanche.
 */
export async function moveDeal(
  id: string,
  stage: DealStage,
  position: number,
): Promise<ActionResult<{ projectId?: string }>> {
  await requireStaff();
  const supabase = await createClient();

  const { data: before } = await supabase.from("deals").select("stage").eq("id", id).single();

  const { error } = await supabase.from("deals").update({ stage, position }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  let projectId: string | undefined;
  if (stage === "gagne" && before?.stage !== "gagne") {
    projectId = (await seedProjectForDeal(id)) ?? undefined;
  }

  revalidatePath("/affaires");
  revalidatePath("/projets");
  return { ok: true, data: { projectId } };
}

export async function updateDeal(
  id: string,
  patch: {
    name?: string;
    amount?: number | null;
    description?: string | null;
    next_step?: string | null;
    next_step_on?: string | null;
    expected_close_on?: string | null;
    lost_reason?: string | null;
    owner_id?: string | null;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("deals").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true };
}

export async function createDeal(input: {
  name: string;
  company_id?: string | null;
  contact_id?: string | null;
  amount?: number | null;
}): Promise<ActionResult<{ id: string }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deals")
    .insert({
      ...input,
      stage: "demande_rdv_envoyee",
      owner_id: profile.id,
      created_by: profile.id,
      position: Date.now() % 1_000_000,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true, data: { id: data.id } };
}

export async function deleteDeal(id: string): Promise<ActionResult> {
  const profile = await requireStaff();
  if (profile.role !== "admin") return { ok: false, error: "Réservé aux administrateurs." };

  const supabase = await createClient();
  const { error } = await supabase.from("deals").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/affaires");
  return { ok: true };
}

/**
 * Ajoute le squelette de tâches et de jalons au projet issu d'une affaire
 * gagnée. Sans effet si le projet a déjà des tâches.
 */
async function seedProjectForDeal(dealId: string): Promise<string | null> {
  const supabase = await createClient();

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

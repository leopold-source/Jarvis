"use server";

import { revalidatePath } from "next/cache";

import type {
  DocumentKind,
  ProjectStatus,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/* ------------------------------------------------------------------ Projet */

export async function updateProject(
  id: string,
  patch: {
    name?: string;
    status?: ProjectStatus;
    description?: string | null;
    start_on?: string | null;
    due_on?: string | null;
    budget?: number | null;
    owner_id?: string | null;
    health?: string | null;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const closing = patch.status === "cloture" ? { closed_at: new Date().toISOString() } : {};
  const { error } = await supabase.from("projects").update({ ...patch, ...closing }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/projets");
  revalidatePath(`/projets/${id}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ Tâches */

export async function createTask(input: {
  project_id: string;
  title: string;
  kind: TaskKind;
  due_on?: string | null;
  assignee_id?: string | null;
  priority?: TaskPriority;
  milestone_id?: string | null;
  is_client_visible?: boolean;
  description?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  // La nouvelle tâche se place en fin de liste.
  const { data: last } = await supabase
    .from("tasks")
    .select("position")
    .eq("project_id", input.project_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...input, created_by: profile.id, position: (last?.position ?? 0) + 100 })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projets/${input.project_id}`);
  return { ok: true, data: { id: data.id } };
}

export async function updateTask(
  id: string,
  projectId: string,
  patch: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    kind?: TaskKind;
    due_on?: string | null;
    assignee_id?: string | null;
    milestone_id?: string | null;
    is_client_visible?: boolean;
    position?: number;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projets/${projectId}`);
  revalidatePath("/projets");
  return { ok: true };
}

export async function deleteTask(id: string, projectId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projets/${projectId}`);
  return { ok: true };
}

/* ------------------------------------------------------------- Commentaires */

export async function addComment(input: {
  project_id: string;
  entity_type: "project" | "task" | "deal";
  entity_id: string;
  body: string;
  is_client_visible: boolean;
}): Promise<ActionResult> {
  const profile = await requireStaff();
  if (!input.body.trim()) return { ok: false, error: "Le message est vide." };

  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({
    project_id: input.project_id,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    body: input.body.trim(),
    is_client_visible: input.is_client_visible,
    author_id: profile.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projets/${input.project_id}`);
  return { ok: true };
}

/* ---------------------------------------------------------------- Documents */

/**
 * Enregistre la fiche d'un document déjà téléversé dans le bucket `documents`.
 * L'envoi du fichier lui-même se fait côté navigateur, directement vers
 * Supabase Storage, pour ne pas faire transiter les octets par le serveur Next.
 */
export async function registerDocument(input: {
  project_id: string;
  name: string;
  kind: DocumentKind;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_client_visible: boolean;
}): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("documents").insert({ ...input, uploaded_by: profile.id });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projets/${input.project_id}`);
  return { ok: true };
}

export async function deleteDocument(
  id: string,
  projectId: string,
  storagePath: string,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase.storage.from("documents").remove([storagePath]);

  revalidatePath(`/projets/${projectId}`);
  return { ok: true };
}

export async function toggleDocumentVisibility(
  id: string,
  projectId: string,
  visible: boolean,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("documents").update({ is_client_visible: visible }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projets/${projectId}`);
  return { ok: true };
}

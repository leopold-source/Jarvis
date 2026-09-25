"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { Todo, TodoComment, TodoStatut } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const STATUTS: TodoStatut[] = ["a_faire", "en_cours", "en_attente", "probleme", "fait"];

type Modifiable = Pick<
  Todo,
  "titre" | "details" | "categorie" | "statut" | "prio" | "assignee_ids" | "due_on" | "deal_id" | "chantier_id"
>;

/** Les seuls champs qu'on laisse écrire : l'argument vient du réseau. */
function nettoyer(patch: Partial<Modifiable>): Partial<Modifiable> | string {
  const propre: Partial<Modifiable> = {};
  if (patch.titre !== undefined) {
    if (!patch.titre.trim()) return "Le titre est vide.";
    propre.titre = patch.titre.trim().slice(0, 300);
  }
  if (patch.details !== undefined) propre.details = patch.details?.trim() ? patch.details.slice(0, 20_000) : null;
  if (patch.categorie !== undefined) propre.categorie = patch.categorie?.trim() ? patch.categorie.trim().slice(0, 60) : null;
  if (patch.statut !== undefined) {
    if (!STATUTS.includes(patch.statut)) return "Statut inconnu.";
    propre.statut = patch.statut;
  }
  if (patch.prio !== undefined) propre.prio = Boolean(patch.prio);
  if (patch.assignee_ids !== undefined) propre.assignee_ids = [...new Set(patch.assignee_ids.filter(Boolean))];
  if (patch.due_on !== undefined) {
    if (patch.due_on && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due_on)) return "Date invalide.";
    propre.due_on = patch.due_on || null;
  }
  if (patch.deal_id !== undefined) propre.deal_id = patch.deal_id || null;
  if (patch.chantier_id !== undefined) propre.chantier_id = patch.chantier_id || null;
  return propre;
}

export async function creerTache(entree: Partial<Modifiable> & { titre: string }): Promise<ActionResult<Todo>> {
  await requireStaff();
  const propre = nettoyer(entree);
  if (typeof propre === "string") return { ok: false, error: propre };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("todos")
    .insert({ ...propre, titre: propre.titre!, position: Date.now() })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/taches");
  revalidatePath("/");
  return { ok: true, data: data as Todo };
}

export async function majTache(id: string, patch: Partial<Modifiable>): Promise<ActionResult<Todo>> {
  await requireStaff();
  const propre = nettoyer(patch);
  if (typeof propre === "string") return { ok: false, error: propre };
  const supabase = await createClient();
  const { data, error } = await supabase.from("todos").update(propre).eq("id", id).select("*").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/taches");
  revalidatePath("/");
  return { ok: true, data: data as Todo };
}

export async function supprimerTache(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/taches");
  revalidatePath("/");
  return { ok: true };
}

export async function fetchCommentaires(todoId: string): Promise<ActionResult<TodoComment[]>> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("todo_comments")
    .select("*")
    .eq("todo_id", todoId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as TodoComment[] };
}

export async function ajouterCommentaire(todoId: string, body: string): Promise<ActionResult<TodoComment>> {
  const profile = await requireStaff();
  if (!body.trim()) return { ok: false, error: "Commentaire vide." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("todo_comments")
    .insert({ todo_id: todoId, body: body.trim().slice(0, 5000), author_id: profile.id })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/taches");
  return { ok: true, data: data as TodoComment };
}

export async function supprimerCommentaire(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("todo_comments").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/taches");
  return { ok: true };
}

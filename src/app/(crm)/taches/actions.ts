"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { Todo, TodoStatut } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const STATUTS: TodoStatut[] = ["a_faire", "en_cours", "en_attente", "probleme", "fait"];

export type TacheModifiable = Pick<
  Todo,
  "titre" | "details" | "categorie" | "statut" | "priorite" | "assignee_ids" | "due_on" | "deal_id" | "chantier_id"
>;

/** Les seuls champs qu'on laisse écrire : l'argument vient du réseau. */
function nettoyer(patch: Partial<TacheModifiable>): Partial<TacheModifiable> | string {
  const propre: Partial<TacheModifiable> = {};
  if (patch.titre !== undefined) {
    if (!patch.titre.trim()) return "La tâche est vide.";
    propre.titre = patch.titre.trim().slice(0, 500);
  }
  if (patch.details !== undefined) propre.details = patch.details?.trim() ? patch.details.slice(0, 20_000) : null;
  if (patch.categorie !== undefined) propre.categorie = patch.categorie?.trim() ? patch.categorie.trim().slice(0, 60) : null;
  if (patch.statut !== undefined) {
    if (!STATUTS.includes(patch.statut)) return "Statut inconnu.";
    propre.statut = patch.statut;
  }
  if (patch.priorite !== undefined) {
    if (patch.priorite !== null && ![1, 2, 3].includes(patch.priorite)) return "Priorité invalide.";
    propre.priorite = patch.priorite;
  }
  if (patch.assignee_ids !== undefined) propre.assignee_ids = [...new Set(patch.assignee_ids.filter(Boolean))];
  if (patch.due_on !== undefined) {
    if (patch.due_on && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due_on)) return "Date invalide.";
    propre.due_on = patch.due_on || null;
  }
  if (patch.deal_id !== undefined) propre.deal_id = patch.deal_id || null;
  if (patch.chantier_id !== undefined) propre.chantier_id = patch.chantier_id || null;
  return propre;
}

function rafraichir() {
  revalidatePath("/taches");
  revalidatePath("/");
}

export async function creerTache(entree: Partial<TacheModifiable> & { titre: string }): Promise<ActionResult<Todo>> {
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
  rafraichir();
  return { ok: true, data: data as Todo };
}

export async function majTache(id: string, patch: Partial<TacheModifiable>): Promise<ActionResult<Todo>> {
  await requireStaff();
  const propre = nettoyer(patch);
  if (typeof propre === "string") return { ok: false, error: propre };
  const supabase = await createClient();
  const { data, error } = await supabase.from("todos").update(propre).eq("id", id).select("*").single();
  if (error) return { ok: false, error: error.message };
  rafraichir();
  return { ok: true, data: data as Todo };
}

/**
 * Écrit la colonne « Com » d'un associé. Chacun n'écrit que la sienne : c'est
 * le serveur qui décide de la clé, pas l'appelant.
 */
export async function majCommentaire(id: string, texte: string): Promise<ActionResult<Todo>> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const { data: tache } = await supabase.from("todos").select("commentaires").eq("id", id).maybeSingle();
  if (!tache) return { ok: false, error: "Tâche introuvable." };
  const commentaires = { ...((tache.commentaires as Record<string, string>) ?? {}) };
  if (texte.trim()) commentaires[profile.id] = texte.trim().slice(0, 5000);
  else delete commentaires[profile.id];
  const { data, error } = await supabase.from("todos").update({ commentaires }).eq("id", id).select("*").single();
  if (error) return { ok: false, error: error.message };
  rafraichir();
  return { ok: true, data: data as Todo };
}

export async function supprimerTache(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rafraichir();
  return { ok: true };
}

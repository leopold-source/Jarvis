"use server";

import { revalidatePath } from "next/cache";

import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Message posté par un client sur l'un de ses projets.
 *
 * Le message est forcément partagé (`is_client_visible`), et la RLS vérifie que
 * le projet appartient bien à l'entreprise du client : impossible d'écrire
 * ailleurs, même en manipulant l'identifiant.
 */
export async function postClientComment(projectId: string, body: string): Promise<ActionResult> {
  const profile = await requireClient();
  if (!body.trim()) return { ok: false, error: "Le message est vide." };

  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({
    project_id: projectId,
    entity_type: "project",
    entity_id: projectId,
    body: body.trim(),
    author_id: profile.id,
    is_client_visible: true,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/portail/${projectId}`);
  return { ok: true };
}

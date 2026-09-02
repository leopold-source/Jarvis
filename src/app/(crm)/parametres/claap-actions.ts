"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireStaff } from "@/lib/auth";
import type { CallKind, CallKindRule, WebhookEvent } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function fetchClaapSettings(): Promise<{
  rules: CallKindRule[];
  events: WebhookEvent[];
  unmappedFolders: string[];
}> {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: rules }, { data: events }, { data: seen }] = await Promise.all([
    supabase.from("call_kind_rules").select("*").order("folder_title"),
    supabase
      .from("webhook_events")
      .select("*")
      .eq("source", "claap")
      .order("created_at", { ascending: false })
      .limit(15),
    // Les dossiers déjà rencontrés sans règle : c'est exactement la liste des
    // règles qu'il reste à écrire, plutôt qu'un formulaire vide.
    supabase.from("call_records").select("folder_title").not("folder_title", "is", null),
  ]);

  const known = new Set((rules ?? []).map((rule) => rule.folder_title.toLowerCase()));
  const unmappedFolders = [
    ...new Set(
      (seen ?? [])
        .map((row) => row.folder_title)
        .filter((title): title is string => Boolean(title) && !known.has(title!.toLowerCase())),
    ),
  ];

  return {
    rules: (rules ?? []) as CallKindRule[],
    events: (events ?? []) as WebhookEvent[],
    unmappedFolders,
  };
}

export async function saveKindRule(folderTitle: string, kind: CallKind): Promise<ActionResult> {
  await requireAdmin();
  const title = folderTitle.trim();
  if (!title) return { ok: false, error: "Le nom du dossier est vide." };

  const supabase = await createClient();
  // On remplace une éventuelle règle existante sur le même dossier plutôt que
  // d'en empiler deux, que rien ne départagerait.
  await supabase.from("call_kind_rules").delete().ilike("folder_title", title);
  const { error } = await supabase.from("call_kind_rules").insert({ folder_title: title, kind });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/parametres");
  return { ok: true };
}

export async function deleteKindRule(id: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("call_kind_rules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/parametres");
  return { ok: true };
}

/**
 * Rejoue l'étiquetage sur les calls déjà rattachés.
 *
 * Utile après avoir ajouté une règle : sans cela, elle ne vaudrait que pour
 * les calls à venir et l'historique resterait incohérent.
 */
export async function reapplyKindRules(): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: rules }, { data: calls }] = await Promise.all([
    supabase.from("call_kind_rules").select("folder_title, kind"),
    supabase.from("call_records").select("id, folder_title").not("folder_title", "is", null),
  ]);

  const byFolder = new Map(
    (rules ?? []).map((rule) => [rule.folder_title.toLowerCase(), rule.kind as CallKind]),
  );

  let updated = 0;
  for (const call of calls ?? []) {
    const kind = byFolder.get((call.folder_title ?? "").toLowerCase()) ?? null;
    const { error } = await supabase.from("call_records").update({ kind }).eq("id", call.id);
    if (!error) updated += 1;
  }

  revalidatePath("/affaires");
  revalidatePath("/parametres");
  return { ok: true, updated };
}

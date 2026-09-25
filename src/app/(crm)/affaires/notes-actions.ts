"use server";

import Anthropic from "@anthropic-ai/sdk";

import { anthropicKey, describeAnthropicError, MISSING_KEY_ERROR } from "@/lib/anthropic";
import { requireStaff } from "@/lib/auth";
import { synthetiser, type SyntheseAffaire } from "@/lib/synthese-affaire";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export type NotesAffaire = {
  note_r1: string | null;
  note_r2: string | null;
  notes_updated_at: string | null;
  synthese: SyntheseAffaire | null;
  synthese_at: string | null;
  /** Les résumés Claap de l'affaire, à insérer dans une note. */
  calls: Array<{ id: string; titre: string; quand: string | null; resume: string }>;
};

export async function fetchNotes(dealId: string): Promise<ActionResult<NotesAffaire>> {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: deal, error }, { data: calls }] = await Promise.all([
    supabase
      .from("deals")
      .select("note_r1, note_r2, notes_updated_at, synthese_ia, synthese_ia_at")
      .eq("id", dealId)
      .maybeSingle(),
    supabase
      .from("call_records")
      .select("id, title, started_at, occurred_on, summary")
      .eq("deal_id", dealId)
      .not("summary", "is", null)
      .order("occurred_on", { ascending: false })
      .limit(10),
  ]);
  if (error || !deal) return { ok: false, error: error?.message ?? "Affaire introuvable." };
  return {
    ok: true,
    data: {
      note_r1: deal.note_r1,
      note_r2: deal.note_r2,
      notes_updated_at: deal.notes_updated_at,
      synthese: (deal.synthese_ia as SyntheseAffaire | null) ?? null,
      synthese_at: deal.synthese_ia_at,
      calls: (calls ?? []).map((c) => ({
        id: c.id,
        titre: c.title ?? "Call",
        quand: c.started_at ?? c.occurred_on,
        resume: c.summary ?? "",
      })),
    },
  };
}

/** Enregistre une note — appelée par la sauvegarde automatique de l'éditeur. */
export async function enregistrerNote(
  dealId: string,
  quelle: "r1" | "r2",
  html: string,
): Promise<ActionResult<{ at: string }>> {
  await requireStaff();
  if (html.length > 200_000) return { ok: false, error: "Note trop longue." };
  const supabase = await createClient();
  const at = new Date().toISOString();
  const { error } = await supabase
    .from("deals")
    .update(quelle === "r1" ? { note_r1: html, notes_updated_at: at } : { note_r2: html, notes_updated_at: at })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { at } };
}

/** Régénère la synthèse IA — uniquement sur demande. */
export async function genererSynthese(
  dealId: string,
): Promise<ActionResult<{ synthese: SyntheseAffaire; at: string }>> {
  await requireStaff();
  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };
  try {
    const { synthese, modele } = await synthetiser(dealId);
    const at = new Date().toISOString();
    const supabase = await createClient();
    await supabase
      .from("deals")
      .update({ synthese_ia: synthese as never, synthese_ia_at: at, synthese_ia_model: modele })
      .eq("id", dealId);
    return { ok: true, data: { synthese, at } };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Anthropic.APIError
          ? describeAnthropicError(caught)
          : caught instanceof Error
            ? caught.message
            : "Synthèse impossible.",
    };
  }
}

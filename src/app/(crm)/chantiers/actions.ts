"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { ChantierStatus, MetricSource } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/* --------------------------------------------------------------- Chantiers */

export async function createChantier(input: {
  title: string;
  intention?: string | null;
  owner_id?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("chantiers")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("chantiers")
    .insert({
      title: input.title,
      intention: input.intention ?? null,
      owner_id: input.owner_id ?? profile.id,
      created_by: profile.id,
      position: (last?.position ?? 0) + 100,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/chantiers");
  return { ok: true, data: { id: data.id } };
}

export async function updateChantier(
  id: string,
  patch: {
    title?: string;
    intention?: string | null;
    owner_id?: string | null;
    status?: ChantierStatus;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  // Un chantier terminé quitte le tableau mais reste en base, daté. C'est ce
  // couple début / fin qui permettra plus tard de mesurer combien de temps
  // nous coûte réellement un chantier — une donnée qu'aucune suppression ne
  // rendrait.
  const closing =
    patch.status === "termine"
      ? { completed_at: new Date().toISOString() }
      : patch.status
        ? { completed_at: null }
        : {};

  const { error } = await supabase
    .from("chantiers")
    .update({ ...patch, ...closing, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/chantiers");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteChantier(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("chantiers").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/chantiers");
  return { ok: true };
}

/* --------------------------------------------------------------- Objectifs */

export async function createObjectif(input: {
  chantier_id: string;
  title: string;
  rationale?: string | null;
  target_value: number;
  unit?: string | null;
  source: MetricSource;
  due_on?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("objectifs")
    .insert({
      chantier_id: input.chantier_id,
      title: input.title,
      rationale: input.rationale ?? null,
      target_value: input.target_value,
      unit: input.unit ?? null,
      source: input.source,
      due_on: input.due_on ?? null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/chantiers");
  return { ok: true, data: { id: data.id } };
}

export async function updateObjectif(
  id: string,
  patch: {
    title?: string;
    rationale?: string | null;
    target_value?: number;
    current_value?: number;
    unit?: string | null;
    source?: MetricSource;
    due_on?: string | null;
    completed_at?: string | null;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase
    .from("objectifs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/chantiers");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteObjectif(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("objectifs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/chantiers");
  return { ok: true };
}

/* ------------------------------------------------- Mesure automatique */

/**
 * Recalcule les objectifs dont le chiffre est déjà connu du CRM.
 *
 * Chaque source est un comptage simple et explicable — on préfère une mesure
 * que l'on peut justifier ligne à ligne à une estimation savante. Ce qui n'est
 * pas mesurable ici reste en saisie manuelle, assumée comme telle.
 *
 * Les objectifs `manuel` ne sont jamais touchés : la valeur saisie fait foi.
 */
export async function refreshObjectifs(): Promise<ActionResult<{ updated: number }>> {
  await requireStaff();
  const supabase = await createClient();

  const { data: objectifs, error } = await supabase
    .from("objectifs")
    .select("id, source, starts_on, due_on, current_value")
    .neq("source", "manuel");

  if (error) return { ok: false, error: error.message };

  let updated = 0;

  for (const objectif of objectifs ?? []) {
    const from = `${objectif.starts_on}T00:00:00Z`;
    const until = objectif.due_on ? `${objectif.due_on}T23:59:59Z` : null;
    const value = await measure(supabase, objectif.source, objectif.starts_on, from, until);

    if (value !== Number(objectif.current_value)) {
      await supabase
        .from("objectifs")
        .update({ current_value: value, updated_at: new Date().toISOString() })
        .eq("id", objectif.id);
      updated += 1;
    }
  }

  revalidatePath("/chantiers");
  revalidatePath("/");
  return { ok: true, data: { updated } };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function measure(
  supabase: Supabase,
  source: MetricSource,
  startsOn: string,
  from: string,
  until: string | null,
): Promise<number> {
  const bound = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
    query: T,
    column: string,
    lower: string,
  ): T => {
    const scoped = query.gte(column, lower);
    return until ? scoped.lte(column, until) : scoped;
  };

  switch (source) {
    // Une affaire naît d'un rendez-vous obtenu : sa date de création est le
    // marqueur le plus fiable dont nous disposons, faute d'historique d'étape.
    case "rdv_pris": {
      const { count } = await bound(
        supabase.from("deals").select("id", { count: "exact", head: true }),
        "created_at",
        from,
      );
      return count ?? 0;
    }

    case "affaires_gagnees": {
      const { count } = await bound(
        supabase.from("deals").select("id", { count: "exact", head: true }).eq("stage", "gagne"),
        "won_at",
        from,
      );
      return count ?? 0;
    }

    case "ca_facture": {
      const { data } = await bound(
        supabase
          .from("invoices")
          .select("amount_ttc")
          .in("status", ["emise", "payee"])
          .not("issued_on", "is", null),
        "issued_on",
        startsOn,
      );
      return (data ?? []).reduce((sum, row) => sum + Number(row.amount_ttc), 0);
    }

    case "ca_encaisse": {
      const { data } = await bound(
        supabase.from("invoices").select("paid_amount").not("paid_on", "is", null),
        "paid_on",
        startsOn,
      );
      return (data ?? []).reduce((sum, row) => sum + Number(row.paid_amount), 0);
    }

    // Le trigger sur `leads` tient `status_changed_at` à jour : un lead dont le
    // statut a bougé sur la période est un lead que l'on a travaillé.
    case "leads_contactes": {
      const { count } = await bound(
        supabase.from("leads").select("id", { count: "exact", head: true }),
        "status_changed_at",
        from,
      );
      return count ?? 0;
    }

    default:
      return 0;
  }
}

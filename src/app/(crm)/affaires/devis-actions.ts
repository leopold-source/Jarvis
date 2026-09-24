"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { DevisPennylane } from "@/lib/database.types";
import { synchroniserDevis, type BilanDevis } from "@/lib/devis-pennylane";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

type DevisAffiche = Omit<DevisPennylane, "raw">;
const COLONNES =
  "id, pennylane_id, numero, statut, statut_brut, montant_ht, emis_le, echeance_le, client_pennylane_id, client_nom, url, deal_id, lie_a_la_main, statut_change_le, synced_at, created_at" as const;

/** Les devis d'une affaire, et ceux qui n'ont encore trouvé la leur. */
export async function fetchDevisAffaire(
  dealId: string,
): Promise<ActionResult<{ lies: DevisAffiche[]; libres: DevisAffiche[] }>> {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: lies, error }, { data: libres }] = await Promise.all([
    supabase.from("devis_pennylane").select(COLONNES).eq("deal_id", dealId).order("emis_le", { ascending: false }),
    supabase.from("devis_pennylane").select(COLONNES).is("deal_id", null).order("emis_le", { ascending: false }).limit(50),
  ]);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { lies: (lies ?? []) as DevisAffiche[], libres: (libres ?? []) as DevisAffiche[] } };
}

/**
 * Rattache un devis à une affaire, ou l'en détache.
 *
 * Marqué « à la main » dans les deux cas : un choix humain n'est jamais défait
 * par la synchronisation, y compris celui de laisser un devis sans affaire.
 */
export async function lierDevis(devisId: string, dealId: string | null): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("devis_pennylane")
    .update({ deal_id: dealId, lie_a_la_main: true })
    .eq("id", devisId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/affaires");
  return { ok: true };
}

/** Relit Pennylane tout de suite, sans attendre l'intervalle. */
export async function synchroniserDevisMaintenant(): Promise<BilanDevis> {
  await requireStaff();
  const bilan = await synchroniserDevis({ force: true });
  revalidatePath("/affaires");
  revalidatePath("/projets");
  return bilan;
}

"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import { revokeToken } from "@/lib/google";
import { syncAllGoogleAccounts, type SyncOutcome } from "@/lib/gmail-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Synchronise les boîtes de toute l'équipe.
 *
 * Le fil d'une affaire est commun : un mail de Romain au client en fait
 * partie autant qu'un mail de Léopold. Synchroniser seulement la boîte de qui
 * clique laissait l'autre moitié des échanges attendre la nuit — et le
 * rattrapage d'historique ne la rattrapait jamais.
 *
 * `profond` rejoue quatre mois au lieu de reprendre à la dernière exécution :
 * c'est ce qu'il faut après avoir ajouté un interlocuteur à une affaire.
 */
export async function syncGmail(profond = false): Promise<SyncOutcome> {
  await requireStaff();
  const bilan = await syncAllGoogleAccounts(profond ? { joursEnArriere: 120 } : {});

  revalidatePath("/parametres");
  revalidatePath("/affaires");
  revalidatePath("/projets");

  if (bilan.accounts === 0) return { ok: false, error: "Aucune boîte Gmail connectée." };
  if (bilan.failed.length === bilan.accounts) {
    return { ok: false, error: bilan.failed.map((f) => `${f.email} : ${f.error}`).join(" · ") };
  }
  return {
    ok: true,
    imported: bilan.imported,
    scanned: 0,
    since: bilan.failed.length
      ? `Échec pour ${bilan.failed.map((f) => f.email).join(", ")}`
      : "",
  };
}

/** Déconnecte le compte : jeton révoqué côté Google, ligne supprimée en base. */
export async function disconnectGmail(): Promise<ActionResult> {
  const profile = await requireStaff();

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Clé SUPABASE_SERVICE_ROLE_KEY absente." };

  const { data: account } = await admin
    .from("google_accounts")
    .select("refresh_token")
    .eq("user_id", profile.id)
    .maybeSingle();

  if (account?.refresh_token) await revokeToken(account.refresh_token);

  const { error } = await admin.from("google_accounts").delete().eq("user_id", profile.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/parametres");
  return { ok: true };
}

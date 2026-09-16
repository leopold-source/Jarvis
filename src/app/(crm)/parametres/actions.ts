"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import { revokeToken } from "@/lib/google";
import { syncGmailForUser, type SyncOutcome } from "@/lib/gmail-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Lance une synchronisation pour le compte de l'utilisateur connecté.
 *
 * `profond` rejoue quatre mois au lieu de reprendre à la dernière exécution.
 * C'est ce qu'il faut après avoir ajouté un interlocuteur à une affaire : ses
 * échanges passés sont antérieurs au dernier passage, et une exécution
 * ordinaire ne les verrait jamais.
 */
export async function syncGmail(profond = false): Promise<SyncOutcome> {
  const profile = await requireStaff();
  const result = await syncGmailForUser(profile.id, profond ? { joursEnArriere: 120 } : {});
  if (result.ok) {
    revalidatePath("/parametres");
    revalidatePath("/affaires");
    revalidatePath("/projets");
  }
  return result;
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

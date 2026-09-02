"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Changement de mot de passe.
 *
 * Supabase autorise la mise à jour sur la seule foi de la session, sans
 * redemander l'ancien mot de passe. On le redemande quand même, en le
 * revalidant par une connexion : sinon, un poste laissé ouvert quelques
 * minutes suffirait à verrouiller le compte de son propriétaire.
 */
export async function changePassword(current: string, next: string): Promise<PasswordResult> {
  const profile = await requireProfile();

  if (next.length < 10) {
    return { ok: false, error: "Le nouveau mot de passe doit faire au moins 10 caractères." };
  }
  if (next === current) {
    return { ok: false, error: "Le nouveau mot de passe est identique à l'ancien." };
  }

  const supabase = await createClient();

  const { error: wrongPassword } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: current,
  });
  if (wrongPassword) return { ok: false, error: "Mot de passe actuel incorrect." };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

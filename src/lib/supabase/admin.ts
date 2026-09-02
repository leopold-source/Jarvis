import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Client à privilèges, réservé au serveur.
 *
 * Il contourne RLS : à n'utiliser que là où la vérification des droits a déjà
 * été faite en amont, et jamais pour servir une requête du navigateur telle
 * quelle. Renvoie `null` si la clé n'est pas configurée, pour que l'appelant
 * puisse afficher un message utile plutôt que planter.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

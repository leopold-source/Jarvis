import "server-only";

import { isInternal } from "@/lib/claap";
import { listCalendarEvents, refreshAccessToken } from "@/lib/google";
import { plusTot, rdvAvec, type RdvTrouve } from "@/lib/rdv-logique";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Le prochain rendez-vous avec l'une de ces adresses, dans l'agenda de toute
 * l'équipe.
 *
 * Toute l'équipe, parce que c'est souvent l'associé qui a posé l'invitation.
 * Un agenda illisible — jeton expiré, périmètre manquant — est sauté sans
 * bruit : on cherche une date, pas une panne.
 */
export async function chercherRdv(
  emails: string[],
  options: { depuis?: Date; jours?: number } = {},
): Promise<RdvTrouve | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: comptes } = await admin.from("google_accounts").select("email, refresh_token, scope");

  // Seules les adresses du prospect comptent : chercher celle d'un associé
  // ramènerait n'importe laquelle de ses réunions.
  const equipe = new Set((comptes ?? []).map((c) => c.email.toLowerCase()));
  const cherchees = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(
    (e) => e && !isInternal(e) && !equipe.has(e),
  );
  if (cherchees.length === 0) return null;
  const depuis = options.depuis ?? new Date();
  const jusqua = new Date(depuis.getTime() + (options.jours ?? 60) * 86_400_000);

  const trouves = await Promise.all(
    (comptes ?? [])
      .filter((c) => c.refresh_token && c.scope?.includes("calendar"))
      .map(async (compte) => {
        try {
          const { access_token } = await refreshAccessToken(compte.refresh_token);
          const events = await listCalendarEvents(access_token, depuis, jusqua, 250);
          return rdvAvec(events, cherchees, depuis.getTime(), compte.email);
        } catch {
          return null;
        }
      }),
  );
  return plusTot(trouves);
}

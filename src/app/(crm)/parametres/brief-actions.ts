"use server";

import { requireAdmin } from "@/lib/auth";
import { envoyerBriefs, type BriefOutcome } from "@/lib/brief-matinal";

/** Envoie le récap commercial tout de suite, pour le voir sans attendre demain matin. */
export async function envoyerBriefMaintenant(): Promise<BriefOutcome[]> {
  await requireAdmin();
  return envoyerBriefs({ force: true });
}

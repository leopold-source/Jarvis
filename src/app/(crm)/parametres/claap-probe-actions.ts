"use server";

import { requireAdmin } from "@/lib/auth";
import { claapKey, probeClaap, type ProbeResult } from "@/lib/claap-api";

/**
 * Constate quelle convention d'appel répond chez Claap.
 *
 * L'application, elle, atteint l'API — contrairement à l'environnement où ce
 * code a été écrit. C'est donc elle qui établit le fait, plutôt que nous qui
 * le supposions.
 */
export async function runClaapProbe(): Promise<
  { ok: true; results: ProbeResult[] } | { ok: false; error: string }
> {
  await requireAdmin();

  const key = claapKey();
  if (!key) {
    return { ok: false, error: "Clé CLAAP_API_KEY absente des variables d'environnement." };
  }

  try {
    return { ok: true, results: await probeClaap(key) };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Sondage impossible." };
  }
}

import "server-only";

import { normalizeClaapPayload } from "@/lib/claap";
import { attachCall } from "@/lib/claap-sync";
import { claapGet, claapKey } from "@/lib/claap-api";
import { createAdminClient } from "@/lib/supabase/admin";

/** Les refus qui ne disaient rien de l'authenticité de l'événement. */
const REFUS_A_REJOUER = ["signature_refusee", "signature_absente", "secret_different", "identifiant_absent"];

/**
 * L'événement a-t-il été envoyé par Claap ?
 *
 * On ne garde pas le secret reçu, seulement son début et sa longueur — de quoi
 * reconnaître le bon sans le recopier. Un événement dont l'en-tête ne commence
 * pas comme notre secret, ou n'a pas sa longueur, n'est pas rejoué : ce serait
 * rendre au premier venu la porte qu'on vient de fermer.
 */
function envoyeParClaap(entetes: unknown, secret: string): boolean {
  if (!entetes || typeof entetes !== "object") return false;
  const masque = (entetes as Record<string, unknown>)["x-claap-webhook-secret"];
  if (typeof masque !== "string") return false;
  const lu = /^(.*?)… \((\d+) car\.\)$/.exec(masque);
  if (!lu) return false;
  const [, debut, longueur] = lu;
  return debut.length >= 3 && secret.startsWith(debut) && secret.length === Number(longueur);
}

export type Rejeu = {
  lus: number;
  rattaches: number;
  enAttente: number;
  ignores: number;
  refuses: number;
  /** Les affaires qui ont reçu un call : leurs récaps en attente sont à réveiller. */
  affaires: string[];
};

/**
 * Rejoue les événements Claap refusés à tort.
 *
 * Tant que la vérification attendait une signature que Claap n'envoie pas,
 * chaque call a été journalisé puis refusé. Les corps sont restés en base : on
 * les relit ici, une fois par enregistrement, le plus récent d'abord. Le
 * résumé y est ; le transcript aussi, tant que son lien n'a pas expiré.
 */
export async function rejouerEvenementsClaap(options: { depuis?: string } = {}): Promise<Rejeu> {
  const bilan: Rejeu = { lus: 0, rattaches: 0, enAttente: 0, ignores: 0, refuses: 0, affaires: [] };
  const admin = createAdminClient();
  const secret = process.env.CLAAP_WEBHOOK_SECRET?.trim();
  if (!admin || !secret) return bilan;

  let requete = admin
    .from("webhook_events")
    .select("id, headers, body, created_at")
    .eq("source", "claap")
    .in("outcome", REFUS_A_REJOUER)
    .order("created_at", { ascending: false })
    .limit(300);
  if (options.depuis) requete = requete.gte("created_at", options.depuis);

  const { data: evenements } = await requete;
  const vus = new Set<string>();

  for (const evenement of evenements ?? []) {
    bilan.lus += 1;
    const corps = evenement.body as Record<string, unknown> | null;
    const call = corps ? normalizeClaapPayload(corps) : null;

    if (!call || !envoyeParClaap(evenement.headers, secret)) {
      bilan.refuses += 1;
      await admin.from("webhook_events").update({ outcome: "rejeu_refuse" }).eq("id", evenement.id);
      continue;
    }

    // Claap réémet chaque événement plusieurs fois : le plus récent suffit.
    if (vus.has(call.providerCallId)) {
      await admin.from("webhook_events").update({ outcome: "rejeu_doublon" }).eq("id", evenement.id);
      continue;
    }
    vus.add(call.providerCallId);

    const issue = await attachCall(call, corps);
    if (issue.status === "rattache") {
      bilan.rattaches += 1;
      if (issue.dealId && !bilan.affaires.includes(issue.dealId)) bilan.affaires.push(issue.dealId);
    } else if (issue.status === "en_attente") bilan.enAttente += 1;
    else bilan.ignores += 1;

    await admin
      .from("webhook_events")
      .update({ outcome: `rejeu_${issue.status}` })
      .eq("id", evenement.id);
  }

  return bilan;
}

/**
 * Va chercher chez Claap les calls des dernières heures.
 *
 * Le webhook suffit quand il arrive. Ceci sert quand on ne veut pas l'attendre
 * — au passage en R2, où un call vient presque toujours d'avoir lieu. Sans clé
 * d'API, on s'en passe : les événements finiront par arriver seuls.
 */
export async function tirerCallsRecents(heures = 36): Promise<{ ok: boolean; tires: number; detail: string }> {
  if (!claapKey()) return { ok: false, tires: 0, detail: "CLAAP_API_KEY absente : on attend le webhook." };

  const depuis = new Date(Date.now() - heures * 3_600_000).toISOString().slice(0, 10);
  const liste = await claapGet(`/recordings?limit=20&createdAt[gte]=${depuis}`);
  if (!liste.ok) return { ok: false, tires: 0, detail: liste.detail };

  const brut = liste.data as Record<string, unknown>;
  const enregistrements = (
    (Array.isArray(brut?.recordings) && brut.recordings) ||
    (Array.isArray(brut?.data) && brut.data) ||
    (Array.isArray(brut) && brut) ||
    []
  ) as Array<Record<string, unknown>>;

  let tires = 0;
  for (const resume of enregistrements) {
    const id = (resume.recordingId ?? resume.id) as string | undefined;
    if (!id) continue;

    // Le détail porte les participants et le résumé ; la liste, rarement.
    const detail = await claapGet(`/recordings/${encodeURIComponent(id)}`);
    const corps = (detail.ok ? detail.data : resume) as Record<string, unknown>;
    const call = normalizeClaapPayload(corps);
    if (!call) continue;

    const issue = await attachCall(call, corps);
    if (issue.status === "rattache") tires += 1;
  }

  return { ok: true, tires, detail: `${enregistrements.length} call(s) récent(s) lus chez Claap.` };
}

import "server-only";

import type { DealStage } from "@/lib/database.types";
import {
  devisDeLaPage,
  etapeApresDevis,
  lireDevis,
  nomReduit,
  pageSuivante,
  statutRetenu,
  type DevisLu,
} from "@/lib/devis-logique";
import { lirePennylane, pennylaneKey } from "@/lib/pennylane";
import { amorcerProjet } from "@/lib/projet-amorce";
import { createAdminClient } from "@/lib/supabase/admin";

/** On ne relit pas Pennylane plus d'une fois tous les dix minutes, sauf demande expresse. */
const INTERVALLE_MS = 10 * 60_000;
const PAGES_MAX = 5;

export type BilanDevis =
  | {
      ok: true;
      lus: number;
      lies: number;
      /** Les affaires que la synchro a fait avancer : « Formation IA — Acme → Gagné ». */
      transitions: Array<{ dealId: string; nom: string; vers: DealStage }>;
      saute?: boolean;
    }
  | { ok: false; error: string };

/** Affaires fermées : un devis n'y est rattaché qu'en dernier recours. */
const FERMEES: DealStage[] = ["perdu", "non_qualifie"];

/**
 * Relit les devis de Pennylane et fait avancer les affaires.
 *
 * Trois temps. On lit tous les devis — Pennylane ne prévient pas quand l'un
 * change de statut. On rattache chacun à son affaire par son client : d'abord
 * l'identifiant Pennylane déjà connu de l'entreprise, puis le nom, réduit à ce
 * qui le distingue. Enfin, quand un statut a changé, l'affaire suit : devis
 * envoyé → propale, devis accepté → gagnée, projet créé.
 *
 * Un rattachement fait à la main n'est jamais défait. Un refus ou une
 * expiration ne ferment jamais une affaire d'eux-mêmes.
 */
export async function synchroniserDevis(options: { force?: boolean } = {}): Promise<BilanDevis> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Clé de service absente." };
  if (!pennylaneKey()) return { ok: false, error: "PENNYLANE_API_KEY absente des variables d'environnement." };

  const { data: reglage } = await admin.from("app_settings").select("value").eq("key", "devis_sync").maybeSingle();
  const derniere = (reglage?.value as { at?: string } | null)?.at;
  if (!options.force && derniere && Date.now() - Date.parse(derniere) < INTERVALLE_MS) {
    return { ok: true, lus: 0, lies: 0, transitions: [], saute: true };
  }
  await admin
    .from("app_settings")
    .upsert({ key: "devis_sync", value: { at: new Date().toISOString() } as never }, { onConflict: "key" });

  // --- 1. Lire ---------------------------------------------------------------
  const lus: Array<{ devis: DevisLu; brut: unknown }> = [];
  let curseur: string | null = null;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const reponse = await lirePennylane(`/quotes?limit=100${curseur ? `&cursor=${encodeURIComponent(curseur)}` : ""}`);
    if (!reponse.ok) return { ok: false, error: `Lecture des devis refusée : ${reponse.error}` };
    for (const brut of devisDeLaPage(reponse.data)) {
      const devis = lireDevis(brut);
      if (devis) lus.push({ devis, brut });
    }
    curseur = pageSuivante(reponse.data);
    if (!curseur) break;
  }

  const [{ data: existants }, { data: entreprises }, { data: affaires }] = await Promise.all([
    admin.from("devis_pennylane").select("pennylane_id, statut, deal_id, lie_a_la_main, client_nom"),
    admin.from("companies").select("id, name, pennylane_customer_id"),
    admin.from("deals").select("id, name, company_id, stage, amount, updated_at").order("updated_at", { ascending: false }),
  ]);

  const parId = new Map((existants ?? []).map((d) => [d.pennylane_id, d]));
  const entrepriseParClient = new Map(
    (entreprises ?? []).filter((e) => e.pennylane_customer_id).map((e) => [e.pennylane_customer_id!, e.id]),
  );
  const entrepriseParNom = new Map((entreprises ?? []).map((e) => [nomReduit(e.name), e.id]));
  const affaireDe = new Map<string, NonNullable<typeof affaires>[number]>();
  for (const affaire of affaires ?? []) {
    if (!affaire.company_id) continue;
    const deja = affaireDe.get(affaire.company_id);
    // L'affaire ouverte la plus récente ; une fermée seulement faute de mieux.
    if (!deja || (FERMEES.includes(deja.stage) && !FERMEES.includes(affaire.stage))) {
      affaireDe.set(affaire.company_id, affaire);
    }
  }
  const affaireParId = new Map((affaires ?? []).map((a) => [a.id, a]));

  // Le nom du client, quand le devis ne donne que son identifiant.
  const noms = new Map<string, string>();
  for (const d of existants ?? []) if (d.client_nom) noms.set(d.pennylane_id, d.client_nom);
  const clientsSansNom = [
    ...new Set(lus.filter(({ devis }) => devis.clientId && !devis.clientNom).map(({ devis }) => devis.clientId!)),
  ].filter((id) => !entrepriseParClient.has(id));
  const nomClient = new Map<string, string>();
  for (const id of clientsSansNom.slice(0, 50)) {
    const client = await lirePennylane<{ name?: string }>(`/customers/${encodeURIComponent(id)}`);
    if (client.ok && client.data?.name) nomClient.set(id, client.data.name);
  }

  // --- 2. Rattacher, et 3. faire avancer ---------------------------------------
  let lies = 0;
  const transitions: Array<{ dealId: string; nom: string; vers: DealStage }> = [];

  for (const { devis, brut } of lus) {
    const avant = parId.get(devis.pennylaneId);
    const clientNom = devis.clientNom ?? (devis.clientId ? nomClient.get(devis.clientId) : null) ?? avant?.client_nom ?? null;

    let dealId = avant?.deal_id ?? null;
    if (!avant?.lie_a_la_main && !dealId) {
      const entrepriseId =
        (devis.clientId ? entrepriseParClient.get(devis.clientId) : undefined) ??
        (clientNom ? entrepriseParNom.get(nomReduit(clientNom)) : undefined);
      if (entrepriseId) {
        dealId = affaireDe.get(entrepriseId)?.id ?? null;
        // Retenir l'identifiant Pennylane : le prochain devis de ce client se
        // rattachera sans passer par le nom.
        if (devis.clientId && !entrepriseParClient.has(devis.clientId)) {
          await admin.from("companies").update({ pennylane_customer_id: devis.clientId }).eq("id", entrepriseId);
          entrepriseParClient.set(devis.clientId, entrepriseId);
        }
      }
    }
    if (dealId) lies += 1;

    devis.statut = statutRetenu(avant?.statut, devis.statut);
    const change = avant?.statut !== devis.statut;
    await admin.from("devis_pennylane").upsert(
      {
        pennylane_id: devis.pennylaneId,
        numero: devis.numero,
        statut: devis.statut,
        statut_brut: devis.statutBrut,
        montant_ht: devis.montantHt,
        emis_le: devis.emisLe,
        echeance_le: devis.echeanceLe,
        client_pennylane_id: devis.clientId,
        client_nom: clientNom,
        url: devis.url,
        deal_id: dealId,
        raw: brut as never,
        synced_at: new Date().toISOString(),
        ...(change ? { statut_change_le: new Date().toISOString() } : {}),
      },
      { onConflict: "pennylane_id" },
    );

    if (!dealId || !change) continue;
    const affaire = affaireParId.get(dealId);
    if (!affaire) continue;

    // Le montant de l'affaire, s'il n'était pas renseigné, devient celui du devis.
    if (affaire.amount == null && devis.montantHt != null) {
      await admin.from("deals").update({ amount: devis.montantHt }).eq("id", dealId);
    }

    const vers = etapeApresDevis(devis.statut, affaire.stage);
    if (!vers) continue;
    await admin.from("deals").update({ stage: vers }).eq("id", dealId);
    if (vers === "gagne") await amorcerProjet(admin, dealId);
    affaire.stage = vers;
    transitions.push({ dealId, nom: affaire.name, vers });
  }

  return { ok: true, lus: lus.length, lies, transitions };
}

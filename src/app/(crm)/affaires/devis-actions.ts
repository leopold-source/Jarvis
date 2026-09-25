"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { DealStage, DevisPennylane } from "@/lib/database.types";
import {
  adresseEnBloc,
  controlerSaisie,
  corpsClient,
  corpsCorrection,
  corpsDevis,
  decouperAdresse,
  idsDesLignes,
  plusJours,
  TAUX_TVA,
  type ClientSaisi,
  type CodeTva,
  type SaisieDevis,
} from "@/lib/devis-emission";
import { etapeApresDevis, lireDevis } from "@/lib/devis-logique";
import { synchroniserDevis, type BilanDevis } from "@/lib/devis-pennylane";
import { callPennylane, lirePennylane, pennylaneKey, pennylaneReady } from "@/lib/pennylane";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/utils";

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

/* ------------------------------------------------------------ Émission */

export type ProduitPennylane = {
  id: number;
  libelle: string;
  description: string;
  prixHt: number;
  unite: string;
  tva: CodeTva;
};

/** Un client tel que Pennylane le renvoie — ce qu'on en lit, du moins. */
type ClientPennylane = {
  id?: number;
  name?: string;
  reg_no?: string | null;
  vat_number?: string | null;
  emails?: string[];
  recipient?: string | null;
  billing_address?: { address?: string; postal_code?: string; city?: string; country_alpha2?: string } | null;
};

/** La fiche d'un client Pennylane, sous la forme de la saisie — pour l'aperçu. */
function ficheDe(c: ClientPennylane): ClientSaisi {
  return {
    nom: c.name ?? "",
    siret: c.reg_no ?? "",
    tva: c.vat_number ?? "",
    adresse: c.billing_address?.address ?? "",
    codePostal: c.billing_address?.postal_code ?? "",
    ville: c.billing_address?.city ?? "",
    pays: c.billing_address?.country_alpha2 ?? "FR",
    email: c.emails?.[0] ?? "",
    destinataire: c.recipient ?? "",
  };
}

export type PreparationDevis = {
  /** Faux tant que `PENNYLANE_ENABLED` n'est pas levé : on peut saisir, pas créer. */
  ecriturePermise: boolean;
  /** `fiche` : ce que Pennylane imprimera dans le bloc client, pour l'aperçu. */
  clientPennylane: { id: string; nom: string; fiche: ClientSaisi | null } | null;
  saisie: SaisieDevis;
  produits: ProduitPennylane[];
};

type Liste<T> = { items?: T[] };

const CODES_TVA = new Set<string>(TAUX_TVA.map((t) => t.code));

function nombreOuZero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tout ce qu'il faut pour ouvrir le formulaire : le client Pennylane s'il
 * existe déjà, les produits du catalogue, et une première ligne tirée de
 * l'affaire.
 */
export async function preparerDevis(dealId: string): Promise<ActionResult<PreparationDevis>> {
  await requireStaff();
  if (!pennylaneKey()) return { ok: false, error: "PENNYLANE_API_KEY absente des variables d'environnement." };
  const supabase = await createClient();

  const { data: deal } = await supabase
    .from("deals")
    .select("id, name, amount, description, company_id, contact_id")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { ok: false, error: "Affaire introuvable." };

  const [{ data: entreprise }, { data: contact }] = await Promise.all([
    deal.company_id
      ? supabase
          .from("companies")
          .select("id, name, siret, vat_number, billing_address, address, billing_email, pennylane_customer_id")
          .eq("id", deal.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    deal.contact_id
      ? supabase.from("contacts").select("full_name, email").eq("id", deal.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Le client chez Pennylane : par l'identifiant déjà retenu, sinon par le nom.
  let clientPennylane: PreparationDevis["clientPennylane"] = null;
  if (entreprise?.pennylane_customer_id) {
    const lu = await lirePennylane<ClientPennylane>(`/customers/${encodeURIComponent(entreprise.pennylane_customer_id)}`);
    clientPennylane = {
      id: entreprise.pennylane_customer_id,
      nom: (lu.ok && lu.data?.name) || entreprise.name,
      fiche: lu.ok && lu.data ? ficheDe(lu.data) : null,
    };
  } else if (entreprise?.name) {
    const filtre = encodeURIComponent(JSON.stringify([{ field: "name", operator: "eq", value: entreprise.name }]));
    const lu = await lirePennylane<Liste<ClientPennylane>>(`/customers?limit=5&filter=${filtre}`);
    const trouve = lu.ok ? lu.data?.items?.find((c) => c.id != null) : undefined;
    if (trouve) clientPennylane = { id: String(trouve.id), nom: trouve.name ?? entreprise.name, fiche: ficheDe(trouve) };
  }

  const catalogue = await lirePennylane<
    Liste<{ id?: number; label?: string; description?: string; price_before_tax?: string; unit?: string; vat_rate?: string; archived_at?: string | null }>
  >("/products?limit=100");
  const produits: ProduitPennylane[] = (catalogue.ok ? (catalogue.data?.items ?? []) : [])
    .filter((p) => p.id != null && p.label && !p.archived_at)
    .map((p) => ({
      id: p.id!,
      libelle: p.label!,
      description: p.description ?? "",
      prixHt: nombreOuZero(p.price_before_tax),
      unite: p.unit || "forfait",
      tva: (CODES_TVA.has(p.vat_rate ?? "") ? p.vat_rate : "FR_200") as CodeTva,
    }));

  const adresse = decouperAdresse(entreprise?.billing_address || entreprise?.address);
  const client: ClientSaisi = {
    nom: entreprise?.name ?? "",
    siret: entreprise?.siret ?? "",
    tva: entreprise?.vat_number ?? "",
    ...adresse,
    pays: "FR",
    email: entreprise?.billing_email || contact?.email || "",
    destinataire: contact?.full_name ?? "",
  };

  const aujourdhui = todayIso();
  return {
    ok: true,
    data: {
      ecriturePermise: pennylaneReady(),
      clientPennylane,
      produits,
      saisie: {
        clientPennylaneId: clientPennylane?.id ?? null,
        client,
        date: aujourdhui,
        echeance: plusJours(aujourdhui, 30),
        objet: deal.name,
        description: "",
        mentions: "",
        remisePct: 0,
        lignes: [
          {
            libelle: deal.name,
            description: deal.description ?? "",
            quantite: 1,
            prixUnitaireHt: Number(deal.amount ?? 0),
            unite: "forfait",
            tva: "FR_200",
          },
        ],
      },
    },
  };
}

export type DevisEmis = { id: string; pennylaneId: string; numero: string | null };

/**
 * Crée le devis chez Pennylane — ou le corrige, s'il existe déjà.
 *
 * Rien ne part chez le client : l'API v2 ne connaît pas l'e-signature, c'est
 * depuis Pennylane qu'on l'envoie. Chez nous, le devis reste « en brouillon »
 * tant que personne n'a dit l'avoir envoyé, et l'affaire ne bouge pas.
 */
export async function emettreDevis(
  dealId: string,
  saisie: SaisieDevis,
  pennylaneIdACorriger: string | null = null,
): Promise<ActionResult<DevisEmis>> {
  await requireStaff();
  if (!pennylaneReady()) {
    return {
      ok: false,
      error: "Écriture Pennylane désactivée : ajoutez PENNYLANE_ENABLED=true dans les variables Vercel.",
    };
  }
  const erreurs = controlerSaisie(saisie);
  if (erreurs.length) return { ok: false, error: erreurs.join(" ") };

  const supabase = await createClient();
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Clé de service absente." };

  const { data: deal } = await supabase.from("deals").select("id, name, amount, company_id").eq("id", dealId).maybeSingle();
  if (!deal) return { ok: false, error: "Affaire introuvable." };

  // --- Le client ---------------------------------------------------------------
  let clientId = saisie.clientPennylaneId;
  if (!clientId) {
    const cree = await callPennylane<{ id?: number }>({
      operation: "creer_client",
      method: "POST",
      path: "/company_customers",
      body: corpsClient(saisie.client),
    });
    if (!cree.ok) return { ok: false, error: `Pennylane refuse le client : ${cree.error}` };
    if (cree.data?.id == null) return { ok: false, error: "Pennylane n'a pas renvoyé d'identifiant client." };
    clientId = String(cree.data.id);

    // L'entreprise retient son identifiant, et ce qu'on vient de saisir pour
    // elle comble ses champs vides.
    if (deal.company_id) {
      const { data: e } = await supabase
        .from("companies")
        .select("siret, vat_number, billing_address, billing_email")
        .eq("id", deal.company_id)
        .maybeSingle();
      const c = saisie.client;
      await supabase
        .from("companies")
        .update({
          pennylane_customer_id: clientId,
          ...(!e?.siret && c.siret.trim() ? { siret: c.siret.replace(/\s/g, "") } : {}),
          ...(!e?.vat_number && c.tva.trim() ? { vat_number: c.tva.trim() } : {}),
          ...(!e?.billing_address ? { billing_address: adresseEnBloc(c) } : {}),
          ...(!e?.billing_email && c.email.trim() ? { billing_email: c.email.trim() } : {}),
        })
        .eq("id", deal.company_id);
    }
  } else if (deal.company_id) {
    await supabase
      .from("companies")
      .update({ pennylane_customer_id: clientId })
      .eq("id", deal.company_id)
      .is("pennylane_customer_id", null);
  }

  const numeroClient = Number(clientId);
  if (!Number.isInteger(numeroClient)) return { ok: false, error: `Identifiant client Pennylane inattendu : ${clientId}.` };

  // --- Le devis ----------------------------------------------------------------
  let reponse;
  if (pennylaneIdACorriger) {
    const lignes = await lirePennylane(`/quotes/${encodeURIComponent(pennylaneIdACorriger)}/invoice_lines?limit=100`);
    if (!lignes.ok) return { ok: false, error: `Lignes du devis illisibles : ${lignes.error}` };
    reponse = await callPennylane({
      operation: "corriger_devis",
      method: "PUT",
      path: `/quotes/${encodeURIComponent(pennylaneIdACorriger)}`,
      body: corpsCorrection(saisie, numeroClient, idsDesLignes(lignes.data)),
    });
  } else {
    reponse = await callPennylane({
      operation: "creer_devis",
      method: "POST",
      path: "/quotes",
      body: corpsDevis(saisie, numeroClient, `jarvis:${dealId}:${Date.now()}`),
    });
  }
  if (!reponse.ok) return { ok: false, error: `Pennylane refuse le devis : ${reponse.error}` };

  const devis = lireDevis(reponse.data);
  if (!devis) return { ok: false, error: "Réponse de Pennylane illisible." };

  const { data: ligne, error } = await admin
    .from("devis_pennylane")
    .upsert(
      {
        pennylane_id: devis.pennylaneId,
        numero: devis.numero,
        // En brouillon chez nous tant qu'il n'est pas parti, quoi qu'en dise l'API.
        ...(pennylaneIdACorriger ? {} : { statut: "brouillon" as const, statut_change_le: new Date().toISOString() }),
        statut_brut: devis.statutBrut,
        montant_ht: devis.montantHt,
        emis_le: devis.emisLe,
        echeance_le: devis.echeanceLe,
        client_pennylane_id: devis.clientId ?? clientId,
        client_nom: devis.clientNom ?? (saisie.clientPennylaneId ? null : saisie.client.nom),
        url: devis.url,
        deal_id: dealId,
        lie_a_la_main: true,
        raw: reponse.data as never,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "pennylane_id" },
    )
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (deal.amount == null && devis.montantHt != null) {
    await supabase.from("deals").update({ amount: devis.montantHt }).eq("id", dealId);
  }

  revalidatePath("/affaires");
  return { ok: true, data: { id: ligne.id, pennylaneId: devis.pennylaneId, numero: devis.numero } };
}

/**
 * « C'est parti en e-signature » : le devis passe en attente de signature, et
 * l'affaire en propale si elle n'y était pas.
 */
export async function marquerDevisEnvoye(devisId: string): Promise<ActionResult<{ vers: DealStage | null }>> {
  await requireStaff();
  const supabase = await createClient();
  const { data: devis, error } = await supabase
    .from("devis_pennylane")
    .update({ statut: "en_attente", statut_change_le: new Date().toISOString() })
    .eq("id", devisId)
    .eq("statut", "brouillon")
    .select("deal_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!devis?.deal_id) return { ok: true, data: { vers: null } };

  const { data: deal } = await supabase.from("deals").select("stage").eq("id", devis.deal_id).maybeSingle();
  const vers = deal ? etapeApresDevis("en_attente", deal.stage) : null;
  if (vers) await supabase.from("deals").update({ stage: vers }).eq("id", devis.deal_id);

  revalidatePath("/affaires");
  return { ok: true, data: { vers } };
}

/** La saisie d'un devis déjà créé, relue chez Pennylane, pour le corriger. */
export async function relireSaisie(pennylaneId: string): Promise<ActionResult<SaisieDevis>> {
  await requireStaff();
  const [devis, lignes] = await Promise.all([
    lirePennylane<Record<string, unknown>>(`/quotes/${encodeURIComponent(pennylaneId)}`),
    lirePennylane<Liste<Record<string, unknown>>>(`/quotes/${encodeURIComponent(pennylaneId)}/invoice_lines?limit=100`),
  ]);
  if (!devis.ok) return { ok: false, error: devis.error };
  if (!lignes.ok) return { ok: false, error: lignes.error };
  const d = devis.data;
  const idClient = (d.customer as { id?: number } | null)?.id;
  const client = idClient != null ? await lirePennylane<ClientPennylane>(`/customers/${idClient}`) : null;
  const remise = d.discount as { type?: string; value?: string } | null | undefined;
  const texte = (v: unknown) => (typeof v === "string" ? v : "");

  return {
    ok: true,
    data: {
      clientPennylaneId: String((d.customer as { id?: number } | null)?.id ?? ""),
      client:
        client?.ok && client.data
          ? ficheDe(client.data)
          : { nom: "", siret: "", tva: "", adresse: "", codePostal: "", ville: "", pays: "FR", email: "", destinataire: "" },
      date: texte(d.date).slice(0, 10),
      echeance: texte(d.deadline).slice(0, 10),
      objet: texte(d.pdf_invoice_subject),
      description: texte(d.pdf_description),
      mentions: texte(d.special_mention),
      remisePct: remise?.type === "relative" ? nombreOuZero(remise.value) : 0,
      lignes: (lignes.data?.items ?? []).map((l) => {
        const quantite = nombreOuZero(l.quantity) || 1;
        return {
          libelle: texte(l.label),
          description: texte(l.description),
          quantite,
          prixUnitaireHt:
            nombreOuZero(l.raw_currency_unit_price) || nombreOuZero(l.currency_amount_before_tax) / quantite,
          unite: texte(l.unit) || "forfait",
          tva: (CODES_TVA.has(texte(l.vat_rate)) ? l.vat_rate : "FR_200") as CodeTva,
        };
      }),
    },
  };
}

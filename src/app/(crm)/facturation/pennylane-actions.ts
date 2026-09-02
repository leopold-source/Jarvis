"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireStaff } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { callPennylane, pennylaneReady, probePennylane } from "@/lib/pennylane";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Circuit de validation avant Pennylane.
 *
 * Aucune de ces actions n'envoie quoi que ce soit au client. Le devis comme la
 * facture ne sont poussés qu'en brouillon ; c'est depuis Pennylane, après
 * relecture, qu'ils partent. Le jour où la confiance est acquise, il suffira de
 * lever le garde-fou `PENNYLANE_ENABLED` puis d'ajouter l'envoi — le circuit,
 * lui, ne change pas.
 */

/** Ce qui manque au dossier pour qu'un devis puisse exister. */
export async function checkDossierReady(
  dossierId: string,
): Promise<{ ok: true; missing: string[] }> {
  await requireStaff();
  const supabase = await createClient();

  const { data: dossier } = await supabase
    .from("dossiers")
    .select("amount_ht, company_id, contact_id")
    .eq("id", dossierId)
    .maybeSingle();

  const missing: string[] = [];
  if (!dossier) return { ok: true, missing: ["Dossier introuvable"] };

  if (Number(dossier.amount_ht) <= 0) missing.push("Le montant du devis est à zéro");
  if (!dossier.company_id) {
    missing.push("Aucune entreprise rattachée");
  } else {
    const { data: company } = await supabase
      .from("companies")
      .select("name, siret, vat_number, billing_address, billing_email")
      .eq("id", dossier.company_id)
      .maybeSingle();

    // Pennylane identifie un client par son SIRET ou son numéro de TVA. Sans
    // l'un des deux, la fiche client ne peut pas être créée — autant le dire
    // ici plutôt que de laisser l'appel échouer plus tard.
    if (!company?.siret && !company?.vat_number) {
      missing.push("Ni SIRET ni numéro de TVA sur l'entreprise");
    }
    if (!company?.billing_address) missing.push("Adresse de facturation absente");
    if (!company?.billing_email) missing.push("E-mail de facturation absent");
  }

  return { ok: true, missing };
}

/** Marque le devis prêt pour relecture, et prévient. */
export async function submitQuoteForReview(dossierId: string): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { missing } = await checkDossierReady(dossierId);
  if (missing.length > 0) {
    return { ok: false, error: `Il manque : ${missing.join(", ")}.` };
  }

  const { data: dossier, error } = await supabase
    .from("dossiers")
    .update({ quote_review: "a_valider" })
    .eq("id", dossierId)
    .select("code, amount_ttc")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  const result = await notify(
    `Devis ${dossier?.code} à valider`,
    [
      `${profile.full_name ?? profile.email} a préparé le devis <strong>${dossier?.code}</strong>.`,
      `Montant : <strong>${dossier?.amount_ttc} € TTC</strong>.`,
      "Il attend votre relecture avant d'être poussé en brouillon chez Pennylane.",
    ],
    "https://antichaos.dev/facturation",
  );

  revalidatePath("/facturation");
  return { ok: true, message: result.detail };
}

/**
 * Pousse le devis chez Pennylane, en brouillon.
 *
 * Crée d'abord le client s'il n'existe pas, à partir du SIRET ou du numéro de
 * TVA. L'identifiant obtenu est conservé sur l'entreprise : un client n'est
 * créé qu'une fois, même si l'on gagne dix affaires chez lui.
 */
export async function pushQuoteDraft(dossierId: string): Promise<ActionResult> {
  await requireAdmin();

  if (!pennylaneReady()) {
    return {
      ok: false,
      error:
        "Synchronisation Pennylane désactivée. Renseignez PENNYLANE_API_KEY puis PENNYLANE_ENABLED=true une fois le sondage concluant.",
    };
  }

  const supabase = await createClient();

  const { data: dossier } = await supabase
    .from("dossiers")
    .select("id, code, company_id, payment_terms_days")
    .eq("id", dossierId)
    .maybeSingle();
  if (!dossier?.company_id) return { ok: false, error: "Dossier ou entreprise introuvable." };

  const { data: company } = await supabase
    .from("companies")
    .select("id, name, siret, vat_number, billing_address, billing_email, pennylane_customer_id")
    .eq("id", dossier.company_id)
    .maybeSingle();
  if (!company) return { ok: false, error: "Entreprise introuvable." };

  let customerId = company.pennylane_customer_id;

  if (!customerId) {
    const created = await callPennylane<{ id?: string | number }>({
      operation: "creer_client",
      method: "POST",
      path: "/customers",
      dossierId,
      body: {
        name: company.name,
        reg_no: company.siret,
        vat_number: company.vat_number,
        billing_address: company.billing_address,
        emails: company.billing_email ? [company.billing_email] : [],
      },
    });

    if (!created.ok) return { ok: false, error: `Création du client refusée : ${created.error}` };

    customerId = created.data?.id != null ? String(created.data.id) : null;
    if (!customerId) return { ok: false, error: "Pennylane n'a pas renvoyé d'identifiant client." };

    await supabase
      .from("companies")
      .update({ pennylane_customer_id: customerId })
      .eq("id", company.id);
  }

  const { data: lines } = await supabase
    .from("dossier_lines")
    .select("label, quantity, unit_price_ht, vat_rate")
    .eq("dossier_id", dossierId)
    .order("position");

  const quote = await callPennylane<{ id?: string | number; public_url?: string }>({
    operation: "creer_devis_brouillon",
    method: "POST",
    path: "/quotes",
    dossierId,
    body: {
      customer_id: customerId,
      draft: true,
      currency: "EUR",
      line_items: (lines ?? []).map((line) => ({
        label: line.label,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price_ht),
        vat_rate: `FR_${Number(line.vat_rate)}`,
      })),
    },
  });

  if (!quote.ok) return { ok: false, error: `Devis refusé : ${quote.error}` };

  await supabase
    .from("dossiers")
    .update({
      pennylane_customer_id: customerId,
      pennylane_quote_id: quote.data?.id != null ? String(quote.data.id) : null,
      quote_url: quote.data?.public_url ?? null,
      quote_review: "brouillon_pousse",
      quote_pushed_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq("id", dossierId);

  await notify(
    `Devis ${dossier.code} en brouillon chez Pennylane`,
    [
      `Le devis <strong>${dossier.code}</strong> a été créé en brouillon.`,
      "Il n'a pas été envoyé : relisez-le dans Pennylane, puis envoyez-le en e-signature depuis leur interface.",
    ],
    quote.data?.public_url,
  );

  revalidatePath("/facturation");
  return { ok: true, message: "Devis créé en brouillon. Rien n'a été envoyé au client." };
}

/**
 * Crée la facture correspondant à une échéance, en brouillon.
 *
 * Déclenché à la signature du devis pour la première échéance, ou à la main
 * pour les suivantes. Jamais envoyé : c'est le point de contrôle demandé.
 */
export async function pushInvoiceDraft(invoiceId: string): Promise<ActionResult> {
  await requireAdmin();

  if (!pennylaneReady()) {
    return { ok: false, error: "Synchronisation Pennylane désactivée." };
  }

  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, label, amount_ht, vat_rate, due_on, dossier_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { ok: false, error: "Échéance introuvable." };

  const { data: dossier } = await supabase
    .from("dossiers")
    .select("code, pennylane_customer_id")
    .eq("id", invoice.dossier_id)
    .maybeSingle();

  if (!dossier?.pennylane_customer_id) {
    return { ok: false, error: "Le client n'existe pas encore chez Pennylane. Poussez d'abord le devis." };
  }

  const created = await callPennylane<{ id?: string | number; public_url?: string; invoice_number?: string }>({
    operation: "creer_facture_brouillon",
    method: "POST",
    path: "/customer_invoices",
    dossierId: invoice.dossier_id,
    invoiceId,
    body: {
      customer_id: dossier.pennylane_customer_id,
      draft: true,
      currency: "EUR",
      date: new Date().toISOString().slice(0, 10),
      deadline: invoice.due_on,
      line_items: [
        {
          label: invoice.label,
          quantity: 1,
          unit_price: Number(invoice.amount_ht),
          vat_rate: `FR_${Number(invoice.vat_rate)}`,
        },
      ],
    },
  });

  if (!created.ok) return { ok: false, error: `Facture refusée : ${created.error}` };

  await supabase
    .from("invoices")
    .update({
      pennylane_invoice_id: created.data?.id != null ? String(created.data.id) : null,
      invoice_url: created.data?.public_url ?? null,
      invoice_number: created.data?.invoice_number ?? null,
      review: "brouillon_pousse",
      pushed_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  await notify(
    `Facture ${dossier.code} — ${invoice.label} en brouillon`,
    [
      `La facture <strong>${invoice.label}</strong> du dossier ${dossier.code} a été créée en brouillon.`,
      "Elle n'a pas été envoyée. Relisez-la dans Pennylane avant de la finaliser.",
    ],
    created.data?.public_url,
  );

  revalidatePath("/facturation");
  return { ok: true, message: "Facture créée en brouillon. Rien n'a été envoyé." };
}

/** Sondage en lecture seule, pour établir ce que l'API accepte réellement. */
export async function runPennylaneProbe(): Promise<
  { ok: true; results: Awaited<ReturnType<typeof probePennylane>> } | { ok: false; error: string }
> {
  await requireAdmin();
  const results = await probePennylane();
  if (results.length === 0) {
    return { ok: false, error: "Clé PENNYLANE_API_KEY absente des variables d'environnement." };
  }
  return { ok: true, results };
}

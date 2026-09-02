"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import type { Dossier, DossierLine, Invoice, InvoiceStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type DossierDetail = {
  dossier: Dossier;
  lines: DossierLine[];
  invoices: Invoice[];
};

export async function fetchDossier(
  dossierId: string,
): Promise<{ ok: true; detail: DossierDetail } | { ok: false; error: string }> {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: dossier, error }, { data: lines }, { data: invoices }] = await Promise.all([
    supabase.from("dossiers").select("*").eq("id", dossierId).maybeSingle(),
    supabase.from("dossier_lines").select("*").eq("dossier_id", dossierId).order("position"),
    supabase.from("invoices").select("*").eq("dossier_id", dossierId).order("position"),
  ]);

  if (error || !dossier) return { ok: false, error: error?.message ?? "Dossier introuvable." };
  return {
    ok: true,
    detail: {
      dossier: dossier as Dossier,
      lines: (lines ?? []) as DossierLine[],
      invoices: (invoices ?? []) as Invoice[],
    },
  };
}

/** Le dossier rattaché à une affaire, s'il existe. */
export async function fetchDossierForDeal(dealId: string): Promise<Dossier | null> {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("dossiers").select("*").eq("deal_id", dealId).maybeSingle();
  return (data as Dossier) ?? null;
}

/**
 * Recalcule le montant du dossier depuis ses lignes, puis répartit les
 * échéances encore prévues.
 *
 * Les échéances déjà émises ne bougent pas : une facture partie chez le client
 * est un fait, pas une variable d'ajustement.
 */
async function recompute(dossierId: string) {
  const supabase = await createClient();

  const [{ data: lines }, { data: invoices }] = await Promise.all([
    supabase.from("dossier_lines").select("quantity, unit_price_ht").eq("dossier_id", dossierId),
    supabase
      .from("invoices")
      .select("id, status, position")
      .eq("dossier_id", dossierId)
      .order("position"),
  ]);

  const total = (lines ?? []).reduce(
    (sum, line) => sum + Number(line.quantity) * Number(line.unit_price_ht),
    0,
  );
  await supabase.from("dossiers").update({ amount_ht: total }).eq("id", dossierId);

  const pending = (invoices ?? []).filter((invoice) => invoice.status === "prevue");
  if (pending.length === 0) return;

  const { data: issued } = await supabase
    .from("invoices")
    .select("amount_ht")
    .eq("dossier_id", dossierId)
    .neq("status", "prevue");

  const already = (issued ?? []).reduce((sum, invoice) => sum + Number(invoice.amount_ht), 0);
  const remaining = Math.max(0, total - already);
  const share = Math.round((remaining / pending.length) * 100) / 100;

  for (const [index, invoice] of pending.entries()) {
    // La dernière échéance absorbe l'arrondi, pour que la somme tombe juste.
    const amount = index === pending.length - 1 ? remaining - share * (pending.length - 1) : share;
    await supabase.from("invoices").update({ amount_ht: amount }).eq("id", invoice.id);
  }
}

export async function saveLine(
  dossierId: string,
  line: { id?: string; label: string; quantity: number; unit_price_ht: number },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = line.id
    ? await supabase
        .from("dossier_lines")
        .update({ label: line.label, quantity: line.quantity, unit_price_ht: line.unit_price_ht })
        .eq("id", line.id)
    : await supabase.from("dossier_lines").insert({
        dossier_id: dossierId,
        label: line.label,
        quantity: line.quantity,
        unit_price_ht: line.unit_price_ht,
      });

  if (error) return { ok: false, error: error.message };
  await recompute(dossierId);
  revalidatePath("/facturation");
  revalidatePath("/affaires");
  return { ok: true };
}

export async function deleteLine(dossierId: string, lineId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("dossier_lines").delete().eq("id", lineId);
  if (error) return { ok: false, error: error.message };
  await recompute(dossierId);
  revalidatePath("/facturation");
  return { ok: true };
}

/** Fait avancer une échéance. Les dates suivent le statut, jamais l'inverse. */
export async function setInvoiceStatus(
  invoiceId: string,
  status: InvoiceStatus,
  paidAmount?: number,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: invoice } = await supabase
    .from("invoices")
    .select("dossier_id, amount_ttc, issued_on")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { ok: false, error: "Échéance introuvable." };

  const patch: Partial<Invoice> = { status };
  if (status === "emise") {
    patch.issued_on = invoice.issued_on ?? today;
    patch.paid_on = null;
    patch.paid_amount = 0;
  }
  if (status === "payee") {
    patch.issued_on = invoice.issued_on ?? today;
    patch.paid_on = today;
    patch.paid_amount = paidAmount ?? invoice.amount_ttc;
  }
  if (status === "prevue" || status === "annulee") {
    patch.paid_on = null;
    patch.paid_amount = 0;
  }

  const { error } = await supabase.from("invoices").update(patch).eq("id", invoiceId);
  if (error) return { ok: false, error: error.message };

  // Le dossier suit ses échéances : soldé quand plus rien n'est dû.
  const { data: siblings } = await supabase
    .from("invoices")
    .select("status")
    .eq("dossier_id", invoice.dossier_id);

  const live = (siblings ?? []).filter((row) => row.status !== "annulee");
  const allPaid = live.length > 0 && live.every((row) => row.status === "payee");
  const anyIssued = live.some((row) => row.status === "emise" || row.status === "payee");

  if (allPaid) {
    await supabase.from("dossiers").update({ status: "solde" }).eq("id", invoice.dossier_id);
  } else if (anyIssued) {
    await supabase
      .from("dossiers")
      .update({ status: "en_facturation" })
      .eq("id", invoice.dossier_id);
  }

  revalidatePath("/facturation");
  return { ok: true };
}

export async function updateDossier(
  dossierId: string,
  patch: Partial<Pick<Dossier, "status" | "payment_terms_days" | "notes" | "quote_signed_at">>,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("dossiers").update(patch).eq("id", dossierId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/facturation");
  return { ok: true };
}

/** Ajoute une échéance au dossier, puis répartit à nouveau le reste à facturer. */
export async function addInvoice(dossierId: string, label: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("invoices")
    .select("position")
    .eq("dossier_id", dossierId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("invoices").insert({
    dossier_id: dossierId,
    label,
    position: (last?.position ?? -1) + 1,
  });
  if (error) return { ok: false, error: error.message };

  await recompute(dossierId);
  revalidatePath("/facturation");
  return { ok: true };
}

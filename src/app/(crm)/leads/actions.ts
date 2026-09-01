"use server";

import { revalidatePath } from "next/cache";

import { buildLookup, classifyRow, companyKey, emailKey, personKey, type ImportIndex } from "@/lib/leads-dedupe";
import type { LeadStatus } from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function updateLead(
  id: string,
  patch: {
    status?: LeadStatus;
    comment?: string | null;
    follow_up_on?: string | null;
    email?: string | null;
    phone?: string | null;
    company_name?: string | null;
    revenue?: number | null;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true };
}

/**
 * Passe un lead en « call pris » : crée (ou réutilise) l'entreprise et le
 * contact, puis ouvre une affaire à l'étape « Demande de RDV envoyée ».
 * Toute la logique vit dans la fonction SQL `convert_lead_to_deal`, qui reste
 * la source de vérité et garantit l'atomicité.
 */
export async function convertLead(
  leadId: string,
  dealName: string,
  amount: number | null,
): Promise<ActionResult<{ dealId: string }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("convert_lead_to_deal", {
    p_lead_id: leadId,
    p_deal_name: dealName,
    p_amount: amount ?? undefined,
    p_owner_id: profile.id,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as { deal_id?: string } | null;
  if (!payload?.deal_id) return { ok: false, error: "La conversion n'a rien renvoyé." };

  revalidatePath("/leads");
  revalidatePath("/affaires");
  revalidatePath("/contacts");
  revalidatePath("/entreprises");

  return { ok: true, data: { dealId: payload.deal_id } };
}

export async function createLead(input: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  region?: string | null;
  comment?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const fullName = [input.first_name, input.last_name].filter(Boolean).join(" ").trim();

  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...input,
      full_name: fullName || input.email || "Sans nom",
      owner_id: profile.id,
      owner_name: profile.full_name,
      source: "saisie_manuelle",
      status: "nouveau",
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true, data: { id: data.id } };
}

/**
 * Construit l'index de l'existant, utilisé par l'aperçu d'import pour repérer
 * les doublons avant toute écriture.
 */
export async function fetchImportIndex(): Promise<ImportIndex> {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: leads }, { data: companies }, { data: contacts }, { data: deals }] = await Promise.all([
    supabase.from("leads").select("first_name, last_name, full_name, email, company_name"),
    supabase.from("companies").select("id, name"),
    supabase.from("contacts").select("first_name, last_name, full_name, email, company_id"),
    supabase.from("deals").select("company_id"),
  ]);

  const emails = new Set<string>();
  const people = new Set<string>();
  const companiesFromLeads = new Set<string>();
  const companiesInPipeline = new Set<string>();

  const companyNameById = new Map((companies ?? []).map((company) => [company.id, company.name]));

  for (const lead of leads ?? []) {
    const email = emailKey(lead.email);
    if (email) emails.add(email);
    const company = companyKey(lead.company_name);
    if (company) companiesFromLeads.add(company);
    const person = personKey(lead.first_name, lead.last_name, lead.full_name);
    if (person) people.add(`${person}@${company}`);
  }

  // Une fiche entreprise n'existe que parce qu'un lead a été converti : toute
  // entreprise du CRM est donc déjà un compte travaillé.
  for (const company of companies ?? []) {
    const key = companyKey(company.name);
    if (key) companiesInPipeline.add(key);
  }
  for (const deal of deals ?? []) {
    const name = deal.company_id ? companyNameById.get(deal.company_id) : null;
    const key = companyKey(name);
    if (key) companiesInPipeline.add(key);
  }

  for (const contact of contacts ?? []) {
    const email = emailKey(contact.email);
    if (email) emails.add(email);
    const company = companyKey(contact.company_id ? companyNameById.get(contact.company_id) : null);
    const person = personKey(contact.first_name, contact.last_name, contact.full_name);
    if (person) people.add(`${person}@${company}`);
  }

  return {
    emails: [...emails],
    people: [...people],
    companiesFromLeads: [...companiesFromLeads],
    companiesInPipeline: [...companiesInPipeline],
  };
}

/**
 * Import en masse depuis un CSV déjà découpé côté navigateur.
 *
 * L'index est reconstruit ici plutôt que repris du navigateur : entre l'aperçu
 * et la validation, un autre import a pu passer.
 */
export async function importLeads(
  rows: Array<Record<string, string | number | null>>,
): Promise<ActionResult<{ inserted: number; skipped: number }>> {
  const profile = await requireStaff();
  if (profile.role !== "admin") return { ok: false, error: "Réservé aux administrateurs." };
  if (rows.length === 0) return { ok: false, error: "Aucune ligne à importer." };
  if (rows.length > 5000) return { ok: false, error: "Import limité à 5 000 lignes par fichier." };

  const lookup = buildLookup(await fetchImportIndex());
  const seen = { emails: new Set<string>(), people: new Set<string>() };

  const keepers = rows.filter((row) => classifyRow(row, lookup, seen).verdict !== "doublon");
  const skipped = rows.length - keepers.length;

  if (keepers.length === 0) {
    return { ok: false, error: `Les ${rows.length} lignes sont déjà en base.` };
  }

  const supabase = await createClient();
  let inserted = 0;

  // Par lots pour rester sous les limites de taille de requête.
  for (let start = 0; start < keepers.length; start += 200) {
    const batch = keepers.slice(start, start + 200).map((row) => ({
      ...row,
      owner_id: profile.id,
      source: "import_csv",
    }));

    const { error, count } = await supabase
      .from("leads")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(batch as any, { count: "exact" });

    if (error) return { ok: false, error: `Ligne ${start + 1} : ${error.message}` };
    inserted += count ?? batch.length;
  }

  revalidatePath("/leads");
  return { ok: true, data: { inserted, skipped } };
}

"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateContact(
  id: string,
  patch: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    job_title?: string | null;
    linkedin_url?: string | null;
    notes?: string | null;
    company_id?: string | null;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("contacts").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/contacts");
  revalidatePath("/entreprises");
  return { ok: true };
}

export async function updateCompany(
  id: string,
  patch: {
    name?: string;
    website?: string | null;
    sector?: string | null;
    activity?: string | null;
    region?: string | null;
    address?: string | null;
    headcount?: string | null;
    revenue?: number | null;
    notes?: string | null;
    /** Identité fiscale, requise pour créer le client chez Pennylane. */
    siret?: string | null;
    vat_number?: string | null;
    billing_address?: string | null;
    billing_email?: string | null;
  },
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("companies").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/entreprises");
  return { ok: true };
}

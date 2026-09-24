"use server";

import { requireStaff } from "@/lib/auth";
import type { EmailMessage } from "@/lib/database.types";
import { estNotificationAgenda } from "@/lib/mail-bruit";
import { createClient } from "@/lib/supabase/server";

export type DealEmails =
  | { ok: true; messages: EmailMessage[]; connected: boolean }
  | { ok: false; error: string };

/** Échanges rattachés à une affaire, du plus récent au plus ancien. */
export async function fetchDealEmails(dealId: string): Promise<DealEmails> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: messages, error }, { data: account }] = await Promise.all([
    supabase
      .from("email_messages")
      .select("*")
      .eq("deal_id", dealId)
      .order("sent_at", { ascending: false })
      .limit(50),
    supabase.from("google_accounts").select("email").eq("user_id", profile.id).maybeSingle(),
  ]);

  if (error) return { ok: false, error: error.message };
  // Les notifications d'agenda rangées avant qu'on ne les écarte à la source.
  const echanges = ((messages ?? []) as EmailMessage[]).filter(
    (m) => !estNotificationAgenda({ subject: m.subject, from: m.from_email }),
  );
  return { ok: true, messages: echanges, connected: Boolean(account) };
}

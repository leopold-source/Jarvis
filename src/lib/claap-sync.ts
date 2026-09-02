import { createAdminClient } from "@/lib/supabase/admin";
import type { NormalizedCall } from "@/lib/claap";

export type AttachOutcome =
  | { status: "rattache"; dealId: string }
  | { status: "en_attente" }
  | { status: "ignore"; reason: string };

/**
 * Range un call : soit il trouve son affaire, soit il part en file d'attente.
 *
 * L'ordre de rattachement suit la précision : le contact d'abord, l'entreprise
 * ensuite. On ne descend jamais plus bas — pas de rapprochement par nom, qui
 * confondrait deux « Dupont » à la première occasion.
 */
export async function attachCall(call: NormalizedCall, raw: unknown): Promise<AttachOutcome> {
  const admin = createAdminClient();
  if (!admin) return { status: "ignore", reason: "service_role absente" };

  // Un call déjà connu ne se rejoue pas : Claap réémet `recording_updated`
  // à chaque modification, et on ne veut ni doublon ni écrasement d'un
  // rattachement tranché à la main.
  const [{ data: known }, { data: queued }] = await Promise.all([
    admin.from("call_records").select("deal_id").eq("provider", "claap")
      .eq("provider_call_id", call.providerCallId).maybeSingle(),
    admin.from("call_inbox").select("id").eq("provider", "claap")
      .eq("provider_call_id", call.providerCallId).maybeSingle(),
  ]);
  if (known?.deal_id) return { status: "rattache", dealId: known.deal_id };
  if (queued) return { status: "en_attente" };

  if (call.externalEmails.length === 0) {
    return { status: "ignore", reason: "aucun interlocuteur externe" };
  }

  const { data: contact } = await admin
    .from("contacts")
    .select("id, company_id")
    .in("email", call.externalEmails)
    .limit(1)
    .maybeSingle();

  let dealId: string | null = null;
  if (contact) {
    const { data: deal } = await admin
      .from("deals")
      .select("id")
      .or(`contact_id.eq.${contact.id}${contact.company_id ? `,company_id.eq.${contact.company_id}` : ""}`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dealId = deal?.id ?? null;
  }

  if (dealId) {
    await admin.from("call_records").insert({
      provider: "claap",
      provider_call_id: call.providerCallId,
      deal_id: dealId,
      contact_id: contact?.id ?? null,
      company_id: contact?.company_id ?? null,
      title: call.title,
      url: call.url,
      occurred_on: call.occurredOn,
      duration_minutes: call.durationMinutes,
      kind: call.kind,
      has_external: true,
      participants: call.participants as never,
      raw_payload: raw as never,
    });
    return { status: "rattache", dealId };
  }

  await admin.from("call_inbox").insert({
    provider: "claap",
    provider_call_id: call.providerCallId,
    title: call.title,
    url: call.url,
    occurred_on: call.occurredOn,
    participants: call.participants as never,
    suggested_company: call.suggestedCompany,
    raw_payload: raw as never,
  });
  return { status: "en_attente" };
}

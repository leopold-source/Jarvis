import {
  getMessage,
  header,
  listMessages,
  parseAddresses,
  refreshAccessToken,
} from "@/lib/google";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rapprochement des e-mails et des affaires.
 *
 * Le principe : on ne parcourt pas la boîte mail, on la *questionne*. Les
 * adresses des contacts du CRM composent la requête Gmail, si bien que seuls
 * les messages déjà rattachables reviennent — le reste de la correspondance
 * n'est jamais lu, ni stocké. On ne conserve que les en-têtes et l'extrait
 * fourni par Gmail : assez pour retracer un échange, pas assez pour recopier
 * une boîte mail dans le CRM.
 */

/** Adresses par requête : Gmail tolère des `q` longs, mais pas illimités. */
const EMAILS_PER_QUERY = 20;
/** Plafond par exécution, pour tenir dans le temps d'une Server Action. */
const MAX_NEW_MESSAGES = 150;
/** Profondeur du premier passage, quand aucune synchro n'a encore eu lieu. */
const FIRST_RUN_DAYS = 120;

export type SyncOutcome =
  | { ok: true; imported: number; scanned: number; since: string }
  | { ok: false; error: string };

type ContactRow = { id: string; email: string | null; company_id: string | null };
type DealRow = { id: string; contact_id: string | null; company_id: string | null; updated_at: string };

/** Date de départ au format attendu par l'opérateur `after:` de Gmail. */
function gmailDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "/");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export async function syncGmailForUser(userId: string): Promise<SyncOutcome> {
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Clé SUPABASE_SERVICE_ROLE_KEY absente : synchronisation impossible." };
  }

  const { data: account } = await admin
    .from("google_accounts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!account) return { ok: false, error: "Aucun compte Google connecté." };

  const fail = async (error: string): Promise<SyncOutcome> => {
    await admin.from("google_accounts").update({ last_error: error }).eq("user_id", userId);
    return { ok: false, error };
  };

  let accessToken: string;
  try {
    accessToken = (await refreshAccessToken(account.refresh_token)).access_token;
  } catch (caught) {
    return fail(
      caught instanceof Error
        ? `Autorisation Google expirée (${caught.message}). Reconnectez le compte.`
        : "Autorisation Google expirée. Reconnectez le compte.",
    );
  }

  // Le CRM fournit les adresses à surveiller ; sans contact, rien à chercher.
  const [{ data: contacts }, { data: deals }] = await Promise.all([
    admin.from("contacts").select("id, email, company_id").not("email", "is", null),
    admin.from("deals").select("id, contact_id, company_id, updated_at").order("updated_at", { ascending: false }),
  ]);

  const contactRows = (contacts ?? []) as ContactRow[];
  const dealRows = (deals ?? []) as DealRow[];
  const mailbox = account.email.toLowerCase();

  const contactByEmail = new Map<string, ContactRow>();
  for (const contact of contactRows) {
    if (contact.email) contactByEmail.set(contact.email.toLowerCase(), contact);
  }
  if (contactByEmail.size === 0) {
    return { ok: true, imported: 0, scanned: 0, since: account.last_synced_at ?? "" };
  }

  // `deals` arrive trié du plus récent au plus ancien : le premier rencontré
  // pour un contact ou une entreprise est donc l'affaire la plus vivante.
  const dealByContact = new Map<string, string>();
  const dealByCompany = new Map<string, string>();
  for (const deal of dealRows) {
    if (deal.contact_id && !dealByContact.has(deal.contact_id)) dealByContact.set(deal.contact_id, deal.id);
    if (deal.company_id && !dealByCompany.has(deal.company_id)) dealByCompany.set(deal.company_id, deal.id);
  }

  const since =
    account.last_synced_at ??
    new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString();
  const after = gmailDate(since);

  // Les identifiants déjà connus évitent de redemander à Gmail des messages
  // qu'on a déjà, et donc de gaspiller le quota d'appels.
  const { data: known } = await admin
    .from("email_messages")
    .select("provider_message_id")
    .eq("provider", "gmail");
  const seen = new Set((known ?? []).map((row) => row.provider_message_id).filter(Boolean) as string[]);

  const pending = new Set<string>();
  let scanned = 0;

  try {
    for (const group of chunk([...contactByEmail.keys()], EMAILS_PER_QUERY)) {
      const clause = group.map((email) => `from:${email} OR to:${email}`).join(" OR ");
      let pageToken: string | undefined;

      do {
        const page = await listMessages(accessToken, `after:${after} (${clause})`, pageToken);
        for (const message of page.messages ?? []) {
          scanned += 1;
          if (!seen.has(message.id)) pending.add(message.id);
        }
        pageToken = page.nextPageToken;
      } while (pageToken && pending.size < MAX_NEW_MESSAGES);

      if (pending.size >= MAX_NEW_MESSAGES) break;
    }
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : "Recherche Gmail impossible.");
  }

  const rows: Array<Record<string, unknown>> = [];

  try {
    for (const id of [...pending].slice(0, MAX_NEW_MESSAGES)) {
      const message = await getMessage(accessToken, id);

      const from = parseAddresses(header(message, "From"));
      const recipients = [
        ...parseAddresses(header(message, "To")),
        ...parseAddresses(header(message, "Cc")),
      ];

      // Le correspondant est la première adresse connue du CRM qui ne soit pas
      // la boîte elle-même — sans quoi un message à soi-même s'auto-rattacherait.
      const counterpart = [...from, ...recipients].find(
        (address) => address !== mailbox && contactByEmail.has(address),
      );
      if (!counterpart) continue;

      const contact = contactByEmail.get(counterpart)!;
      const dealId =
        dealByContact.get(contact.id) ??
        (contact.company_id ? dealByCompany.get(contact.company_id) : undefined) ??
        null;
      if (!dealId) continue;

      const sentAt = message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : null;

      rows.push({
        deal_id: dealId,
        contact_id: contact.id,
        provider: "gmail",
        provider_message_id: message.id,
        thread_id: message.threadId,
        direction: from.includes(mailbox) ? "outbound" : "inbound",
        from_email: from[0] ?? null,
        to_emails: recipients,
        subject: header(message, "Subject") || null,
        snippet: message.snippet ?? null,
        sent_at: sentAt,
        synced_by: userId,
      });
    }
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : "Lecture des messages impossible.");
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("email_messages")
      .upsert(rows as never, { onConflict: "provider,provider_message_id", ignoreDuplicates: true });
    if (error) return fail(error.message);
  }

  await admin
    .from("google_accounts")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: null,
      synced_count: (account.synced_count ?? 0) + rows.length,
    })
    .eq("user_id", userId);

  return { ok: true, imported: rows.length, scanned, since };
}

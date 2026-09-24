import {
  getMessage,
  header,
  listMessages,
  parseAddresses,
  refreshAccessToken,
} from "@/lib/google";
import { isInternal } from "@/lib/claap";
import { EXCLUSIONS_GMAIL, estNotificationAgenda } from "@/lib/mail-bruit";
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

/*
  Adresses par requête : Gmail tolère des `q` longs, mais pas illimités.

  Dix et non vingt depuis que chaque adresse pèse trois opérateurs au lieu de
  deux — `from:`, `to:` et `cc:`. Une requête reste ainsi sous les quinze cents
  caractères, et trois appels de liste au lieu de deux ne coûtent rien à côté
  d'une requête tronquée qu'on ne verrait pas passer.
*/
const EMAILS_PER_QUERY = 10;
/** Plafond par exécution, pour tenir dans le temps d'une Server Action. */
const MAX_NEW_MESSAGES = 150;
/** Profondeur du premier passage, quand aucune synchro n'a encore eu lieu. */
const FIRST_RUN_DAYS = 120;

export type SyncOutcome =
  | { ok: true; imported: number; scanned: number; since: string }
  | { ok: false; error: string };

type ContactRow = { id: string; email: string | null; company_id: string | null };
type DealRow = { id: string; contact_id: string | null; company_id: string | null; updated_at: string };
type ProjectRow = { id: string; deal_id: string | null; company_id: string | null };

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

/**
 * De chaque interlocuteur vers son affaire — et pas seulement du principal.
 *
 * Une affaire se mène rarement à une voix : le dirigeant décide, le
 * responsable technique cadre, l'assistante organise. Tant que seul
 * `deals.contact_id` servait d'index, les échanges avec les deux autres ne
 * trouvaient aucune affaire et n'étaient pas conservés — le fil d'une affaire
 * montrait une partie de ce qui s'était dit, sans jamais indiquer qu'il en
 * manquait.
 *
 * `deals` est attendu trié du plus récent au plus ancien, et parcouru dans cet
 * ordre : la première affaire rencontrée pour un contact ou une entreprise est
 * donc la plus vivante. Un contact qui suit deux affaires chez le même client
 * voit ses messages aller à celle qui bouge.
 */
export function indexerAffaires(
  deals: Array<Pick<DealRow, "id" | "contact_id" | "company_id">>,
  liens: Array<{ deal_id: string; contact_id: string }>,
): { dealByContact: Map<string, string>; dealByCompany: Map<string, string> } {
  const contactsParAffaire = new Map<string, string[]>();
  for (const lien of liens) {
    const liste = contactsParAffaire.get(lien.deal_id);
    if (liste) liste.push(lien.contact_id);
    else contactsParAffaire.set(lien.deal_id, [lien.contact_id]);
  }

  const dealByContact = new Map<string, string>();
  const dealByCompany = new Map<string, string>();

  for (const deal of deals) {
    for (const contactId of contactsParAffaire.get(deal.id) ?? []) {
      if (!dealByContact.has(contactId)) dealByContact.set(contactId, deal.id);
    }
    // Le déclencheur garantit que le principal figure dans la liste ; cette
    // ligne rattrape une affaire créée avant lui.
    if (deal.contact_id && !dealByContact.has(deal.contact_id)) {
      dealByContact.set(deal.contact_id, deal.id);
    }
    if (deal.company_id && !dealByCompany.has(deal.company_id)) {
      dealByCompany.set(deal.company_id, deal.id);
    }
  }

  return { dealByContact, dealByCompany };
}

/** Ce qu'on retient d'un message échangé avec un lead. */
export type MailLead = { leadId: string; at: string; sens: "envoye" | "recu"; objet: string | null };

/**
 * Le dernier mail échangé avec chaque lead, parmi des messages déjà lus.
 *
 * Un lead n'est pas un contact : ses échanges n'ont pas d'affaire où
 * s'afficher, et on ne les garde pas. On en retient seulement le dernier —
 * quand, dans quel sens, sous quel objet — pour dater sa dernière action.
 */
export function derniersMailsParLead(
  messages: Array<{ from: string[]; to: string[]; at: string | null; objet: string | null }>,
  leadParAdresse: Map<string, string>,
  boite: string,
): Map<string, MailLead> {
  const moi = boite.toLowerCase();
  const retenus = new Map<string, MailLead>();

  for (const message of messages) {
    if (!message.at) continue;
    const envoye = message.from.includes(moi);
    // Envoyé : le lead est parmi les destinataires. Reçu : il est l'expéditeur.
    const candidats = envoye ? message.to : message.from;
    const adresse = candidats.find((a) => a !== moi && leadParAdresse.has(a));
    if (!adresse) continue;

    const leadId = leadParAdresse.get(adresse)!;
    const deja = retenus.get(leadId);
    if (deja && deja.at >= message.at) continue;
    retenus.set(leadId, { leadId, at: message.at, sens: envoye ? "envoye" : "recu", objet: message.objet });
  }
  return retenus;
}

/** Adresses de leads par requête : `from:` et `to:` seulement, pour tenir la longueur. */
const LEADS_PAR_REQUETE = 40;
/** Messages de leads lus par exécution. */
const MAX_MESSAGES_LEADS = 100;

/**
 * Date la dernière action des leads d'après la boîte mail.
 *
 * Passe séparée de celle des contacts, et sans rien stocker : seule la
 * colonne « dernière action » du lead bouge, et seulement si le mail est
 * plus récent que ce qu'elle disait déjà. Un échec ici n'interrompt pas la
 * synchronisation des affaires.
 */
async function suivreMailsLeads(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  accessToken: string,
  after: string,
  boite: string,
  userId: string,
  dejaLus: Set<string>,
): Promise<number> {
  const { data: leads } = await admin
    .from("leads")
    .select("id, email, last_action_at, last_touched_at")
    .not("email", "is", null)
    .is("converted_deal_id", null);

  const leadParAdresse = new Map<string, string>();
  const etat = new Map<string, { last_action_at: string | null; last_touched_at: string | null }>();
  for (const lead of leads ?? []) {
    const adresse = lead.email?.trim().toLowerCase();
    if (!adresse || adresse === boite) continue;
    leadParAdresse.set(adresse, lead.id);
    etat.set(lead.id, { last_action_at: lead.last_action_at, last_touched_at: lead.last_touched_at });
  }
  if (leadParAdresse.size === 0) return 0;

  const aLire = new Set<string>();
  for (const groupe of chunk([...leadParAdresse.keys()], LEADS_PAR_REQUETE)) {
    const clause = groupe.map((email) => `from:${email} OR to:${email}`).join(" OR ");
    const page = await listMessages(accessToken, `after:${after} (${clause}) ${EXCLUSIONS_GMAIL}`);
    for (const message of page.messages ?? []) {
      if (!dejaLus.has(message.id)) aLire.add(message.id);
    }
    if (aLire.size >= MAX_MESSAGES_LEADS) break;
  }

  const lus = [];
  for (const id of [...aLire].slice(0, MAX_MESSAGES_LEADS)) {
    const message = await getMessage(accessToken, id);
    lus.push({
      from: parseAddresses(header(message, "From")),
      to: [...parseAddresses(header(message, "To")), ...parseAddresses(header(message, "Cc"))],
      at: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
      objet: header(message, "Subject") || null,
    });
  }

  let mis = 0;
  for (const mail of derniersMailsParLead(lus, leadParAdresse, boite).values()) {
    const avant = etat.get(mail.leadId);
    if (avant?.last_action_at && avant.last_action_at >= mail.at) continue;

    await admin
      .from("leads")
      .update({
        last_action: "mail",
        last_action_detail: `${mail.sens}|${(mail.objet ?? "").slice(0, 140)}`,
        last_action_at: mail.at,
        // Un mail qu'on envoie est de soi ; un mail reçu n'a pas d'auteur ici.
        last_action_by: mail.sens === "envoye" ? userId : null,
        // Un mail est un contact : « dernier contact » doit le voir aussi.
        ...(!avant?.last_touched_at || avant.last_touched_at < mail.at ? { last_touched_at: mail.at } : {}),
      })
      .eq("id", mail.leadId);
    mis += 1;
  }
  return mis;
}

/**
 * Rapproche la boîte d'un utilisateur et le CRM.
 *
 * `joursEnArriere` force la profondeur au lieu de repartir de la dernière
 * synchronisation. C'est ce qu'il faut après avoir ajouté un interlocuteur à
 * une affaire : ses échanges passés sont antérieurs au dernier passage, et
 * aucune exécution ordinaire n'irait les chercher.
 */
export async function syncGmailForUser(
  userId: string,
  options: { joursEnArriere?: number } = {},
): Promise<SyncOutcome> {
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
  const [{ data: contacts }, { data: deals }, { data: dealContacts }, { data: projects }] =
    await Promise.all([
      admin.from("contacts").select("id, email, company_id").not("email", "is", null),
      admin.from("deals").select("id, contact_id, company_id, updated_at").order("updated_at", { ascending: false }),
      admin.from("deal_contacts").select("deal_id, contact_id"),
      admin.from("projects").select("id, deal_id, company_id"),
    ]);

  const contactRows = (contacts ?? []) as ContactRow[];
  const dealRows = (deals ?? []) as DealRow[];
  const lienRows = (dealContacts ?? []) as Array<{ deal_id: string; contact_id: string }>;
  const projectRows = (projects ?? []) as ProjectRow[];
  const mailbox = account.email.toLowerCase();

  const contactByEmail = new Map<string, ContactRow>();
  for (const contact of contactRows) {
    if (contact.email) contactByEmail.set(contact.email.toLowerCase(), contact);
  }
  if (contactByEmail.size === 0) {
    return { ok: true, imported: 0, scanned: 0, since: account.last_synced_at ?? "" };
  }

  const { dealByContact, dealByCompany } = indexerAffaires(dealRows, lienRows);

  /*
    Le projet, quand il y en a un.

    Un message ne cesse pas d'intéresser le jour où l'affaire est gagnée : c'est
    même à partir de là qu'il compte le plus, puisqu'il devient la trace de ce
    qu'on a promis au client. On rattache donc aussi au projet, par son affaire
    d'origine et, à défaut, par l'entreprise — la moitié des projets n'ont pas
    d'affaire, parce qu'ils ont été créés à la main.
  */
  const projectByDeal = new Map<string, string>();
  const projectByCompany = new Map<string, string>();
  for (const project of projectRows) {
    if (project.deal_id && !projectByDeal.has(project.deal_id)) projectByDeal.set(project.deal_id, project.id);
    if (project.company_id && !projectByCompany.has(project.company_id)) {
      projectByCompany.set(project.company_id, project.id);
    }
  }

  const profondeur = options.joursEnArriere ?? null;
  const since =
    profondeur !== null
      ? new Date(Date.now() - profondeur * 86_400_000).toISOString()
      : (account.last_synced_at ??
        new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString());
  const after = gmailDate(since);

  // Les identifiants déjà connus évitent de redemander à Gmail des messages
  // qu'on a déjà, et donc de gaspiller le quota d'appels.
  const { data: known } = await admin
    .from("email_messages")
    .select("provider_message_id")
    .eq("provider", "gmail");
  const seen = new Set((known ?? []).map((row) => row.provider_message_id).filter(Boolean) as string[]);

  /*
    Le même mail, vu depuis deux boîtes.

    Gmail donne à chaque boîte son propre identifiant de message : un mail que
    Léopold envoie à un client avec Romain en copie existe deux fois, sous deux
    identifiants. Seul l'en-tête `Message-ID`, posé par l'expéditeur, est
    commun aux deux copies — c'est lui qui départage, sans quoi chaque échange
    à plusieurs apparaîtrait en double dans le fil de l'affaire.
  */
  const { data: rfcConnus } = await admin
    .from("email_messages")
    .select("rfc_message_id")
    .not("rfc_message_id", "is", null);
  const rfcVus = new Set((rfcConnus ?? []).map((row) => row.rfc_message_id as string));

  const pending = new Set<string>();
  let scanned = 0;

  try {
    for (const group of chunk([...contactByEmail.keys()], EMAILS_PER_QUERY)) {
      /*
        Trois opérateurs, pas deux.

        `from:` et `to:` couvraient déjà les deux sens — un message reçu comme
        un message envoyé, l'étiquette « Envoyés » n'étant pas un filtre ici.
        Mais `to:` ne regarde que le champ « À » : un client mis en copie d'un
        échange — le cas de toutes les présentations à trois — n'était jamais
        trouvé, et l'affaire n'en gardait aucune trace.
      */
      const clause = group
        .map((email) => `from:${email} OR to:${email} OR cc:${email}`)
        .join(" OR ");
      let pageToken: string | undefined;

      do {
        const page = await listMessages(accessToken, `after:${after} (${clause}) ${EXCLUSIONS_GMAIL}`, pageToken);
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

      // Invitations, acceptations, refus : l'agenda parle, pas les gens.
      const objet = header(message, "Subject") || null;
      if (estNotificationAgenda({ subject: objet, from: from[0] ?? null })) continue;

      const rfc = header(message, "Message-ID").trim() || null;
      if (rfc && rfcVus.has(rfc)) continue;

      // Le correspondant est la première adresse connue du CRM qui ne soit ni
      // la boîte elle-même ni un associé — sans quoi un échange interne
      // s'auto-rattacherait.
      const counterpart = [...from, ...recipients].find(
        (address) => address !== mailbox && !isInternal(address) && contactByEmail.has(address),
      );
      if (!counterpart) continue;
      if (rfc) rfcVus.add(rfc);

      const contact = contactByEmail.get(counterpart)!;
      const dealId =
        dealByContact.get(contact.id) ??
        (contact.company_id ? dealByCompany.get(contact.company_id) : undefined) ??
        null;

      const projectId =
        (dealId ? projectByDeal.get(dealId) : undefined) ??
        (contact.company_id ? projectByCompany.get(contact.company_id) : undefined) ??
        null;

      // Un message sans affaire *ni* projet n'a nulle part où s'afficher : le
      // garder reviendrait à recopier une boîte mail dans le CRM.
      if (!dealId && !projectId) continue;

      const sentAt = message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : null;

      rows.push({
        deal_id: dealId,
        project_id: projectId,
        contact_id: contact.id,
        provider: "gmail",
        provider_message_id: message.id,
        thread_id: message.threadId,
        // Sortant s'il vient de l'équipe, quelle que soit la boîte qui le lit :
        // un mail de Romain, vu depuis la boîte de Léopold, reste un envoi.
        direction: from.includes(mailbox) || from.some(isInternal) ? "outbound" : "inbound",
        from_email: from[0] ?? null,
        to_emails: recipients,
        subject: objet,
        rfc_message_id: rfc,
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

  try {
    await suivreMailsLeads(admin, accessToken, after, mailbox, userId, new Set([...seen, ...pending]));
  } catch {
    // La dernière action des leads est un repère, pas une donnée d'affaire :
    // elle se rattrapera au prochain passage.
  }

  /*
    La borne n'avance que si le passage a tout vu.

    Le plafond par exécution existe pour tenir dans le temps imparti, mais il
    laissait derrière lui des messages que plus personne n'irait chercher :
    `last_synced_at` sautait à maintenant, et le passage suivant commençait
    après eux. En gardant la borne, l'exécution du lendemain reprend où
    celle-ci s'est arrêtée — les identifiants déjà connus faisant qu'elle ne
    refait pas deux fois le même travail.
  */
  const plafonne = pending.size >= MAX_NEW_MESSAGES;

  await admin
    .from("google_accounts")
    .update({
      ...(plafonne ? {} : { last_synced_at: new Date().toISOString() }),
      last_error: null,
      synced_count: (account.synced_count ?? 0) + rows.length,
    })
    .eq("user_id", userId);

  return { ok: true, imported: rows.length, scanned, since };
}

export type SyncAllOutcome = {
  accounts: number;
  imported: number;
  failed: Array<{ userId: string; email: string; error: string }>;
};

/**
 * Synchronise tous les comptes connectés, l'un après l'autre.
 *
 * Séquentiel plutôt qu'en parallèle : chaque compte appelle Gmail plusieurs
 * fois, et une exécution planifiée n'a aucune urgence à gagner quelques
 * secondes — mieux vaut rester loin des limites de débit de l'API.
 */
export async function syncAllGoogleAccounts(
  options: { joursEnArriere?: number } = {},
): Promise<SyncAllOutcome> {
  const admin = createAdminClient();
  if (!admin) return { accounts: 0, imported: 0, failed: [] };

  const { data: accounts } = await admin.from("google_accounts").select("user_id, email");
  const failed: SyncAllOutcome["failed"] = [];
  let imported = 0;

  for (const account of accounts ?? []) {
    const result = await syncGmailForUser(account.user_id, options);
    if (result.ok) {
      imported += result.imported;
    } else {
      failed.push({ userId: account.user_id, email: account.email, error: result.error });
    }
  }

  return { accounts: accounts?.length ?? 0, imported, failed };
}

import { createAdminClient } from "@/lib/supabase/admin";
import type { NormalizedCall } from "@/lib/claap";
import type { CallKind } from "@/lib/database.types";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/** Un transcript d'une heure et demie tient en 150 000 caractères ; au-delà, on coupe. */
const TRANSCRIPT_MAX = 400_000;

/**
 * Télécharge le transcript pendant que son lien est encore valable.
 *
 * Claap ne donne pas le texte mais une adresse signée qui expire en
 * vingt-quatre heures. Remettre ce téléchargement à plus tard, c'est accepter de
 * ne plus pouvoir le faire : il a donc lieu à la réception, et un échec ne bloque
 * pas le rattachement — le call reste utile sans son verbatim.
 */
export async function telechargerTranscript(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!reponse.ok) return null;
    const brut = (await reponse.text()).trim();
    return brut ? brut.slice(0, TRANSCRIPT_MAX) : null;
  } catch {
    return null;
  }
}

/**
 * Qualification déduite du dossier Claap, si une règle le prévoit.
 *
 * Les règles sont en base et modifiables : tout le monde ne range pas ses
 * dossiers, et personne ne range tout. Sans règle correspondante, le call
 * arrive « à qualifier » — ce qui est le comportement honnête.
 */
async function kindForFolder(admin: Admin, folderTitle: string | null): Promise<CallKind | null> {
  if (!folderTitle) return null;
  const { data } = await admin
    .from("call_kind_rules")
    .select("kind")
    .ilike("folder_title", folderTitle.trim())
    .maybeSingle();
  return (data?.kind as CallKind | undefined) ?? null;
}

export type AttachOutcome =
  | { status: "rattache"; dealId: string | null; projectId: string | null; callId: string }
  | { status: "en_attente" }
  | { status: "ignore"; reason: string };

/**
 * Le contenu d'un call — ce qui peut arriver après coup.
 *
 * Claap réémet un événement à chaque étape de traitement : le premier peut
 * arriver sans résumé, le suivant avec. On complète donc sans jamais effacer :
 * une valeur absente de l'événement ne remplace pas une valeur déjà connue.
 */
function contenu(call: NormalizedCall, transcript: string | null) {
  const champs: Record<string, unknown> = {};
  if (call.summary) champs.summary = call.summary;
  if (transcript) champs.transcript = transcript;
  if (call.startedAt) champs.started_at = call.startedAt;
  if (call.endedAt) champs.ended_at = call.endedAt;
  if (call.participants.length) champs.participants = call.participants;
  if (call.durationMinutes != null) champs.duration_minutes = call.durationMinutes;
  return champs;
}

/**
 * Range un call : soit il trouve son affaire, soit il part en file d'attente.
 *
 * L'ordre de rattachement suit la précision : les interlocuteurs d'une affaire
 * d'abord, l'entreprise ensuite. On ne descend jamais plus bas — pas de
 * rapprochement par nom, qui confondrait deux « Dupont » à la première occasion.
 */
export async function attachCall(call: NormalizedCall, raw: unknown): Promise<AttachOutcome> {
  const admin = createAdminClient();
  if (!admin) return { status: "ignore", reason: "service_role absente" };

  const [{ data: known }, { data: queued }] = await Promise.all([
    admin.from("call_records").select("id, deal_id, project_id, transcript").eq("provider", "claap")
      .eq("provider_call_id", call.providerCallId).maybeSingle(),
    admin.from("call_inbox").select("id, transcript").eq("provider", "claap")
      .eq("provider_call_id", call.providerCallId).maybeSingle(),
  ]);

  // Le transcript ne se télécharge qu'une fois : Claap renvoie le même événement
  // plusieurs fois, et le lien ne change pas de contenu.
  const dejaTranscrit = Boolean(known?.transcript ?? queued?.transcript);
  const transcript = dejaTranscrit ? null : await telechargerTranscript(call.transcriptUrl);
  const champs = contenu(call, transcript);

  /*
    Un call déjà rangé se complète, il ne se re-range pas.

    Le rattachement a pu être tranché à la main ; le rejouer écraserait ce
    choix. Seul le contenu — résumé, transcript, horaires — s'ajoute.
  */
  if (known) {
    if (Object.keys(champs).length) {
      await admin.from("call_records").update({ ...champs, raw_payload: raw as never }).eq("id", known.id);
    }
    return { status: "rattache", dealId: known.deal_id, projectId: known.project_id, callId: known.id };
  }
  if (queued) {
    if (Object.keys(champs).length) {
      await admin.from("call_inbox").update({ ...champs, raw_payload: raw as never }).eq("id", queued.id);
    }
    return { status: "en_attente" };
  }

  // Une vraie réunion interne — le point hebdo — n'a rien à faire dans le CRM.
  // Une réunion externe sans adresse connue, si : elle part en file d'attente.
  if (!call.externe) {
    return { status: "ignore", reason: "réunion interne" };
  }

  const { data: contacts } = call.externalEmails.length
    ? await admin.from("contacts").select("id, company_id").in("email", call.externalEmails)
    : { data: [] as Array<{ id: string; company_id: string | null }> };
  const connus = contacts ?? [];

  let dealId: string | null = null;
  let projectId: string | null = null;
  const contact = connus[0] ?? null;

  if (connus.length > 0) {
    /*
      Tous les interlocuteurs de toutes les affaires, pas seulement le
      principal. Un call avec le responsable technique appartient à l'affaire
      dont il est l'un des interlocuteurs, même si ce n'est pas lui qui y
      figure en premier.
    */
    const contactIds = connus.map((c) => c.id);
    const companyIds = [...new Set(connus.map((c) => c.company_id).filter(Boolean))] as string[];

    const [{ data: liens }, { data: parEntreprise }] = await Promise.all([
      admin.from("deal_contacts").select("deal_id").in("contact_id", contactIds),
      companyIds.length
        ? admin.from("deals").select("id").in("company_id", companyIds)
        : Promise.resolve({ data: [] as Array<{ id: string }> }),
    ]);

    const candidats = [
      ...new Set([...(liens ?? []).map((l) => l.deal_id), ...(parEntreprise ?? []).map((d) => d.id)]),
    ];

    if (candidats.length) {
      const { data: deal } = await admin
        .from("deals")
        .select("id, stage")
        .in("id", candidats)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Une affaire gagnée a donné un projet : les échanges qui suivent sont
      // de la production, pas de la vente. On les range dans le projet, sans
      // quoi le compteur de calls d'une affaire signée gonflerait indéfiniment
      // et fausserait toute lecture du cycle commercial.
      if (deal?.stage === "gagne") {
        const { data: project } = await admin
          .from("projects")
          .select("id")
          .eq("deal_id", deal.id)
          .maybeSingle();
        projectId = project?.id ?? null;
      }
      if (!projectId) dealId = deal?.id ?? null;
    }
  }

  if (dealId || projectId) {
    const { data: insere, error } = await admin
      .from("call_records")
      .insert({
        provider: "claap",
        provider_call_id: call.providerCallId,
        deal_id: dealId,
        project_id: projectId,
        contact_id: contact?.id ?? null,
        company_id: contact?.company_id ?? null,
        title: call.title,
        url: call.url,
        occurred_on: call.occurredOn,
        kind: await kindForFolder(admin, call.folderTitle),
        folder_title: call.folderTitle,
        has_external: true,
        participants: call.participants as never,
        raw_payload: raw as never,
        ...champs,
      })
      .select("id")
      .single();
    if (error?.code === "23505") {
      // Le même événement, arrivé en double à quelques millisecondes : l'autre
      // exemplaire a inséré le call. On le reprend au lieu d'échouer.
      const { data: autre } = await admin
        .from("call_records")
        .select("id, deal_id, project_id")
        .eq("provider", "claap")
        .eq("provider_call_id", call.providerCallId)
        .maybeSingle();
      if (autre) return { status: "rattache", dealId: autre.deal_id, projectId: autre.project_id, callId: autre.id };
    }
    if (error || !insere) return { status: "ignore", reason: error?.message ?? "insertion impossible" };
    return { status: "rattache", dealId, projectId, callId: insere.id };
  }

  await admin.from("call_inbox").insert({
    provider: "claap",
    provider_call_id: call.providerCallId,
    title: call.title,
    url: call.url,
    occurred_on: call.occurredOn,
    folder_title: call.folderTitle,
    participants: call.participants as never,
    suggested_company: call.suggestedCompany,
    raw_payload: raw as never,
    ...champs,
  });
  return { status: "en_attente" };
}

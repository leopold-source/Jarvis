"use server";

import { revalidatePath } from "next/cache";

import { buildLookup, classifyRow, companyKey, domainKey, emailKey, personKey, type ImportIndex } from "@/lib/leads-dedupe";
import type { Lead, LeadModifiable, LeadStatus } from "@/lib/database.types";
import { NRP_MAX } from "@/lib/constants";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Les colonnes qu'une fiche laisse écrire, et l'ordre n'a pas d'importance.
 *
 * Le type `LeadModifiable` dit la même chose au compilateur ; cette liste la
 * dit à l'exécution. Les deux sont nécessaires : un argument d'action serveur
 * traverse le réseau, et le typage a disparu quand il arrive.
 */
const CHAMPS_MODIFIABLES = [
  "first_name",
  "last_name",
  "full_name",
  "email",
  "email_quality",
  "phone",
  "phone_standard",
  "job_title",
  "linkedin_url",
  "company_name",
  "company_legal_name",
  "company_website",
  "company_linkedin_url",
  "company_activity",
  "company_description",
  "sector",
  "segment",
  "region",
  "address",
  "siren",
  "siret",
  "headcount",
  "headcount_range",
  "founded_year",
  "revenue",
  "revenue_year",
  "source",
  "status",
  "comment",
  "follow_up_on",
  "owner_id",
] as const satisfies readonly (keyof LeadModifiable)[];

/**
 * Enregistre une fiche, en ne gardant que ce qui lui appartient.
 *
 * Le tri n'est pas une précaution de style. Une action serveur est une adresse
 * publique : elle reçoit ce qu'on lui envoie, pas ce que le formulaire a
 * affiché. Sans ce filtre, un appel forgé réécrirait `touch_count` ou
 * `converted_deal_id` — des colonnes qu'un déclencheur et la conversion
 * tiennent, et qui perdraient tout sens si une main pouvait les contredire.
 */
export async function updateLead(
  id: string,
  patch: Partial<LeadModifiable>,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const retenu: Record<string, unknown> = {};
  for (const champ of CHAMPS_MODIFIABLES) {
    if (champ in patch) retenu[champ] = patch[champ] ?? null;
  }
  if (Object.keys(retenu).length === 0) return { ok: true };

  /*
    `owner_name` double `owner_id` pour que la liste affiche un nom sans
    jointure. Changer l'un sans l'autre laisserait le nom de l'ancien
    propriétaire sur une fiche qui a changé de main — et c'est le nom qu'on
    lit, pas l'identifiant.
  */
  if ("owner_id" in retenu) {
    const owner = retenu.owner_id
      ? (
          await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("id", String(retenu.owner_id))
            .maybeSingle()
        ).data
      : null;
    retenu.owner_name = owner?.full_name ?? owner?.email ?? null;
  }

  const { error } = await supabase.from("leads").update(retenu as Partial<Lead>).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true };
}

/**
 * La fiche entière, telle qu'elle est en base.
 *
 * La liste ne charge qu'une vingtaine de colonnes — envoyer les quarante pour
 * 432 lignes coûtait 233 ko à chaque ouverture de l'écran. Mais on ne peut pas
 * modifier ce qu'on n'a pas reçu : la fiche va chercher le reste à
 * l'ouverture du tiroir, pour une ligne, ce qui ne coûte rien.
 */
export async function fetchLead(id: string): Promise<ActionResult<Lead>> {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Fiche introuvable." };

  return { ok: true, data };
}

/**
 * Un appel de plus sans réponse.
 *
 * Le geste que remplace ce bouton — rouvrir la liste des statuts pour y choisir
 * « NRP 3 » — demandait deux clics et une lecture pour dire une chose qu'on sait
 * déjà en raccrochant. Et il butait à trois.
 *
 * L'incrément passe par la base plutôt que par une valeur calculée côté
 * navigateur : deux onglets ouverts sur la même fiche compteraient sinon le
 * même appel deux fois. C'est aussi ce qui garantit que le déclencheur voie
 * bien un changement et rafraîchisse la date du statut — sans quoi la quatrième
 * tentative laisserait la fiche avec la date de la troisième.
 */
export async function incrementerNrp(
  id: string,
): Promise<ActionResult<{ nrp_count: number }>> {
  await requireStaff();
  const supabase = await createClient();

  const { data: lead, error: lecture } = await supabase
    .from("leads")
    .select("status, nrp_count")
    .eq("id", id)
    .maybeSingle();

  if (lecture) return { ok: false, error: lecture.message };
  if (!lead) return { ok: false, error: "Lead introuvable." };

  // Depuis un autre statut, le premier appel sans réponse vaut « NRP 1 » : on
  // ne compte pas un appel qui n'a pas eu lieu.
  const suivant =
    lead.status === "nrp" ? Math.min(NRP_MAX, (lead.nrp_count ?? 0) + 1) : 1;

  if (lead.status === "nrp" && suivant === lead.nrp_count) {
    return { ok: false, error: `Le compteur est déjà à ${NRP_MAX}.` };
  }

  const { error } = await supabase
    .from("leads")
    .update({ status: "nrp", nrp_count: suivant })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true, data: { nrp_count: suivant } };
}

/** Les champs qu'une sélection multiple peut recevoir d'un coup. */
export type BulkField = "status" | "follow_up_on" | "owner_id" | "comment";

/**
 * Applique une même valeur à plusieurs leads.
 *
 * Réservé aux champs où la répétition a un sens : un statut, une date de
 * relance, un propriétaire, une note. Ni le nom, ni l'e-mail, ni le téléphone —
 * les recopier sur vingt fiches ne corrigerait rien, cela détruirait vingt
 * contacts d'un geste que rien ne rattraperait.
 *
 * Un lead passé en « call pris » demande une conversion, pas une mise à jour :
 * ces lignes sont écartées et signalées plutôt que traitées à moitié.
 */
export async function updateLeads(
  ids: string[],
  field: BulkField,
  value: string | null,
): Promise<ActionResult<{ updated: number }>> {
  await requireStaff();

  if (ids.length === 0) return { ok: false, error: "Aucune ligne sélectionnée." };
  if (field === "status" && value === "call_pris") {
    return {
      ok: false,
      error: "« Call pris » crée une affaire : ouvrez la fiche pour la convertir, une par une.",
    };
  }

  const supabase = await createClient();
  // Le champ est choisi dans une union fermée : le typer ainsi dit à
  // TypeScript ce que la signature garantit déjà.
  const patch = { [field]: value } as Partial<Lead>;

  // `owner_name` double `owner_id` pour l'affichage. L'assignation unitaire
  // tient les deux ; l'oublier ici laisserait le nom de l'ancien propriétaire
  // sur des fiches qui ont changé de main.
  if (field === "owner_id") {
    const { data: owner } = value
      ? await supabase.from("profiles").select("full_name, email").eq("id", value).maybeSingle()
      : { data: null };
    patch.owner_name = owner?.full_name ?? owner?.email ?? null;
  }

  const { error, count } = await supabase
    .from("leads")
    .update(patch, { count: "exact" })
    .in("id", ids);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true, data: { updated: count ?? ids.length } };
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

  // L'affaire revient à qui portait le lead, pas à qui clique : c'est lui qui
  // a décroché le rendez-vous. Un lead sans propriétaire échoit à qui convertit.
  const { data: lead } = await supabase.from("leads").select("owner_id").eq("id", leadId).maybeSingle();

  const { data, error } = await supabase.rpc("convert_lead_to_deal", {
    p_lead_id: leadId,
    p_deal_name: dealName,
    p_amount: amount ?? undefined,
    p_owner_id: lead?.owner_id ?? profile.id,
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

/** Réassigne un lead à un collaborateur (ou le laisse sans propriétaire). */
export async function assignLead(id: string, ownerId: string | null): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();

  const { data: owner } = ownerId
    ? await supabase.from("profiles").select("full_name, email").eq("id", ownerId).maybeSingle()
    : { data: null };

  const { error } = await supabase
    .from("leads")
    .update({ owner_id: ownerId, owner_name: owner?.full_name ?? owner?.email ?? null })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true };
}

/** Les informations d'entreprise qu'un nouveau lead peut reprendre d'une fiche existante. */
export type EntrepriseConnue = {
  source: "crm" | "lead";
  company_name: string;
  company_website: string | null;
  company_activity: string | null;
  company_legal_name: string | null;
  company_linkedin_url: string | null;
  sector: string | null;
  region: string | null;
  address: string | null;
  siren: string | null;
  siret: string | null;
  headcount_range: string | null;
  phone_standard: string | null;
  /** Nombre de leads déjà rattachés à ce nom : « 3 leads » aide à reconnaître. */
  leads: number;
};

const CHAMPS_ENTREPRISE = [
  "company_website",
  "company_activity",
  "company_legal_name",
  "company_linkedin_url",
  "sector",
  "region",
  "address",
  "siren",
  "siret",
  "headcount_range",
  "phone_standard",
] as const;

/**
 * Les entreprises déjà connues dont le nom ressemble à la saisie.
 *
 * Deux sources : les fiches entreprise du CRM — nées d'une conversion — et les
 * noms portés par les leads eux-mêmes. Un nom présent des deux côtés n'apparaît
 * qu'une fois, complété de ce que chaque côté sait.
 */
export async function rechercherEntreprises(q: string): Promise<EntrepriseConnue[]> {
  await requireStaff();
  const terme = q.trim().replace(/[%_,()]/g, " ").trim();
  if (terme.length < 2) return [];
  const supabase = await createClient();

  const [{ data: entreprises }, { data: leads }] = await Promise.all([
    supabase
      .from("companies")
      .select("name, website, activity, sector, region, address, siret, headcount, linkedin_url")
      .ilike("name", `%${terme}%`)
      .limit(8),
    supabase
      .from("leads")
      .select(`company_name, ${CHAMPS_ENTREPRISE.join(", ")}`)
      .ilike("company_name", `%${terme}%`)
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  const parNom = new Map<string, EntrepriseConnue>();
  const cle = (nom: string) => nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  for (const e of entreprises ?? []) {
    parNom.set(cle(e.name), {
      source: "crm",
      company_name: e.name,
      company_website: e.website,
      company_activity: e.activity,
      company_legal_name: null,
      company_linkedin_url: e.linkedin_url,
      sector: e.sector,
      region: e.region,
      address: e.address,
      siren: e.siret ? e.siret.slice(0, 9) : null,
      siret: e.siret,
      headcount_range: e.headcount,
      phone_standard: null,
      leads: 0,
    });
  }

  for (const brut of (leads ?? []) as unknown as Array<Record<string, string | null>>) {
    const nom = brut.company_name?.trim();
    if (!nom) continue;
    const k = cle(nom);
    const deja = parNom.get(k);
    if (!deja) {
      parNom.set(k, {
        source: "lead",
        company_name: nom,
        ...(Object.fromEntries(CHAMPS_ENTREPRISE.map((c) => [c, brut[c] ?? null])) as Pick<
          EntrepriseConnue,
          (typeof CHAMPS_ENTREPRISE)[number]
        >),
        leads: 1,
      });
      continue;
    }
    deja.leads += 1;
    // Ce que la fiche ne savait pas, un lead le sait peut-être.
    for (const c of CHAMPS_ENTREPRISE) if (!deja[c] && brut[c]) deja[c] = brut[c];
  }

  const t = cle(terme);
  return [...parNom.values()]
    .sort((a, b) => {
      // Ce qui commence par la saisie d'abord, puis le CRM, puis les plus fréquents.
      const da = cle(a.company_name).startsWith(t) ? 0 : 1;
      const db = cle(b.company_name).startsWith(t) ? 0 : 1;
      if (da !== db) return da - db;
      if (a.source !== b.source) return a.source === "crm" ? -1 : 1;
      return b.leads - a.leads;
    })
    .slice(0, 8);
}

export async function createLead(input: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  company_name?: string | null;
  region?: string | null;
  comment?: string | null;
  entreprise?: Partial<Pick<EntrepriseConnue, (typeof CHAMPS_ENTREPRISE)[number]>> | null;
}): Promise<ActionResult<{ id: string }>> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { entreprise, ...champs } = input;
  const fullName = [input.first_name, input.last_name].filter(Boolean).join(" ").trim();

  // Seules les colonnes d'entreprise connues passent : l'argument vient du réseau.
  const reprises = Object.fromEntries(
    CHAMPS_ENTREPRISE.flatMap((c) => {
      const v = entreprise?.[c];
      return typeof v === "string" && v.trim() ? [[c, v.trim()]] : [];
    }),
  );

  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...reprises,
      ...champs,
      region: champs.region || (reprises.region as string | undefined) || null,
      full_name: fullName || input.email || "Sans nom",
      owner_id: profile.id,
      owner_name: profile.full_name,
      source: "saisie_manuelle",
      status: "a_contacter",
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

  /**
   * PostgREST plafonne une requête à 1000 lignes. Sans pagination, l'index
   * serait silencieusement tronqué passé ce seuil et des doublons entreraient
   * sans que rien ne le signale — le pire des comportements pour un garde-fou.
   */
  async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase.from(table as never).select(columns).range(from, from + PAGE - 1);
      const page = (data ?? []) as T[];
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  const [leads, companies, contacts, deals] = await Promise.all([
    fetchAll<{
      first_name: string | null; last_name: string | null; full_name: string | null;
      email: string | null; company_name: string | null;
    }>("leads", "first_name, last_name, full_name, email, company_name"),
    fetchAll<{ id: string; name: string }>("companies", "id, name"),
    fetchAll<{
      first_name: string | null; last_name: string | null; full_name: string | null;
      email: string | null; company_id: string | null;
    }>("contacts", "first_name, last_name, full_name, email, company_id"),
    fetchAll<{ company_id: string | null }>("deals", "company_id"),
  ]);

  const emails = new Set<string>();
  const people = new Set<string>();
  const companiesFromLeads = new Set<string>();
  const companiesInPipeline = new Set<string>();
  const domains = new Set<string>();

  const companyNameById = new Map(companies.map((company) => [company.id, company.name]));

  for (const lead of leads) {
    const email = emailKey(lead.email);
    if (email) emails.add(email);
    const company = companyKey(lead.company_name);
    if (company) companiesFromLeads.add(company);
    const person = personKey(lead.first_name, lead.last_name, lead.full_name);
    if (person) people.add(`${person}@${company}`);
    // Le domaine rattrape les filiales, dont la raison sociale diffère.
    const domain = domainKey(lead.email);
    if (domain) domains.add(domain);
  }

  // Une fiche entreprise n'existe que parce qu'un lead a été converti : toute
  // entreprise du CRM est donc déjà un compte travaillé.
  for (const company of companies) {
    const key = companyKey(company.name);
    if (key) companiesInPipeline.add(key);
  }
  for (const deal of deals) {
    const name = deal.company_id ? companyNameById.get(deal.company_id) : null;
    const key = companyKey(name);
    if (key) companiesInPipeline.add(key);
  }

  for (const contact of contacts) {
    const email = emailKey(contact.email);
    if (email) emails.add(email);
    const company = companyKey(contact.company_id ? companyNameById.get(contact.company_id) : null);
    const person = personKey(contact.first_name, contact.last_name, contact.full_name);
    if (person) people.add(`${person}@${company}`);
    const domain = domainKey(contact.email);
    if (domain) domains.add(domain);
  }

  return {
    emails: [...emails],
    people: [...people],
    companiesFromLeads: [...companiesFromLeads],
    companiesInPipeline: [...companiesInPipeline],
    domains: [...domains],
  };
}

/**
 * Remet à jour, depuis le CSV, les leads déjà en base.
 *
 * L'import écarte les doublons — c'est son rôle — mais cela rendait
 * incorrigible ce qui était entré faux. Cinq cent soixante-dix-huit fiches
 * avaient perdu leur statut faute d'une traduction, et aucun passage du même
 * fichier ne pouvait les rattraper : elles étaient déjà là.
 *
 * Trois champs seulement, ceux dont l'export de prospection est la source de
 * vérité : le statut, la date de relance, le compte rendu. Ni le nom, ni
 * l'e-mail, ni le téléphone — le CSV est parfois plus pauvre que la base, et
 * une synchronisation qui appauvrit est pire qu'une absence de synchronisation.
 */
export async function syncLeadsFromCsv(
  rows: Array<Record<string, string | number | null>>,
): Promise<ActionResult<{ updated: number; matched: number }>> {
  const profile = await requireStaff();
  if (profile.role !== "admin") return { ok: false, error: "Réservé aux administrateurs." };
  if (rows.length === 0) return { ok: false, error: "Aucune ligne à synchroniser." };
  if (rows.length > 5000) return { ok: false, error: "Limité à 5 000 lignes par fichier." };

  const supabase = await createClient();

  type Existant = {
    id: string;
    first_name: string | null; last_name: string | null; full_name: string | null;
    email: string | null; company_name: string | null;
    status: LeadStatus; comment: string | null; follow_up_on: string | null;
    status_changed_at: string; last_touched_at: string | null; touch_count: number | null;
  };

  const existants: Existant[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, first_name, last_name, full_name, email, company_name, status, comment, follow_up_on, status_changed_at, last_touched_at, touch_count",
      )
      .range(from, from + 999);
    if (error) return { ok: false, error: error.message };
    const page = (data ?? []) as Existant[];
    existants.push(...page);
    if (page.length < 1000) break;
  }

  // Les mêmes clés que la détection de doublons, pour que « reconnu comme
  // doublon » et « retrouvé pour mise à jour » désignent exactement le même
  // ensemble. Deux règles voisines mais distinctes laisseraient un résidu de
  // fiches ni importées ni corrigées.
  const parEmail = new Map<string, Existant>();
  const parPersonne = new Map<string, Existant>();
  for (const lead of existants) {
    const email = emailKey(lead.email);
    if (email && !parEmail.has(email)) parEmail.set(email, lead);
    const personne = personKey(lead.first_name, lead.last_name, lead.full_name);
    const entreprise = companyKey(lead.company_name);
    const paire = `${personne}@${entreprise}`;
    if (personne && entreprise && !parPersonne.has(paire)) parPersonne.set(paire, lead);
  }

  const asText = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

  type Correction = { lead: Existant; patch: Record<string, unknown>; statutChange: boolean };
  const corrections: Correction[] = [];
  let matched = 0;

  for (const row of rows) {
    const cible =
      parEmail.get(emailKey(asText(row.email))) ??
      parPersonne.get(
        `${personKey(asText(row.first_name), asText(row.last_name), asText(row.full_name))}@${companyKey(asText(row.company_name))}`,
      );
    if (!cible) continue;
    matched += 1;

    const patch: Record<string, unknown> = {};
    const statut = asText(row.status);
    if (statut && statut !== cible.status) patch.status = statut;

    const relance = asText(row.follow_up_on);
    if (relance && relance !== cible.follow_up_on) patch.follow_up_on = relance;

    const commentaire = asText(row.comment);
    if (commentaire && commentaire !== cible.comment) patch.comment = commentaire;

    if (Object.keys(patch).length > 0) {
      corrections.push({ lead: cible, patch, statutChange: "status" in patch });
    }
  }

  if (corrections.length === 0) {
    return { ok: true, data: { updated: 0, matched } };
  }

  /*
    Une correction n'est pas une activité.

    `leads_track_activity` remet `status_changed_at` et `last_touched_at` à
    maintenant dès que le statut bouge — ce qui est juste quand quelqu'un
    raccroche, et faux quand on répare un import. Sans la remise en place qui
    suit, six cents fiches paraîtraient travaillées aujourd'hui, aucune ne
    serait jamais dormante, et la file d'appel mentirait pendant un mois.

    Deux passages sont nécessaires : le déclencheur écrase la valeur qu'on
    donnerait dans le même ordre. Le second ne touche pas au statut, donc il ne
    le réveille pas. L'événement reste inscrit dans `lead_events` : la
    correction est tracée, elle n'est simplement pas comptée comme un appel.
  */
  let updated = 0;
  for (let start = 0; start < corrections.length; start += 25) {
    const lot = corrections.slice(start, start + 25);

    const resultats = await Promise.all(
      lot.map(({ lead, patch }) =>
        supabase.from("leads").update(patch as never).eq("id", lead.id),
      ),
    );
    const echec = resultats.find((r) => r.error);
    if (echec?.error) return { ok: false, error: echec.error.message };

    await Promise.all(
      lot
        .filter((correction) => correction.statutChange)
        .map(({ lead }) =>
          supabase
            .from("leads")
            .update({
              status_changed_at: lead.status_changed_at,
              last_touched_at: lead.last_touched_at,
              touch_count: lead.touch_count ?? 0,
            } as never)
            .eq("id", lead.id),
        ),
    );

    updated += lot.length;
  }

  revalidatePath("/leads");
  return { ok: true, data: { updated, matched } };
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
  const seen = { emails: new Set<string>(), people: new Set<string>(), domains: new Set<string>() };

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

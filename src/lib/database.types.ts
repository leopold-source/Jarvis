/**
 * Typage du schéma Supabase.
 *
 * Écrit à la main plutôt que généré, pour rester lisible : chaque table expose
 * une ligne `Row`, un `Insert` (colonnes à valeur par défaut en optionnel) et
 * un `Update` (tout optionnel). Après une migration, mettre ce fichier à jour.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = "admin" | "member" | "client";

export type LeadStatus =
  | "a_contacter"
  | "nrp"
  | "nrp2"
  | "nrp3"
  | "raccroche_avant_pitch"
  | "a_recontacter"
  | "pas_interesse"
  | "non_qualifie"
  | "call_pris";

export type DealStage =
  | "demande_rdv_envoyee"
  | "r1"
  | "r2"
  | "propale_envoyee"
  | "no_show"
  | "nurturing"
  | "gagne"
  | "perdu"
  | "non_qualifie";

export type ProjectStatus = "cadrage" | "en_cours" | "en_pause" | "livre" | "cloture";
export type TaskKind = "production" | "jalon";
export type TaskStatus = "a_faire" | "en_cours" | "en_revue" | "termine" | "bloque";
export type TaskPriority = "basse" | "normale" | "haute" | "critique";
export type DocumentKind = "devis" | "contrat" | "livrable" | "brief" | "facture" | "autre";
export type EntityKind = "lead" | "company" | "contact" | "deal" | "project" | "task";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  role: AppRole;
  company_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Company = {
  id: string;
  name: string;
  website: string | null;
  sector: string | null;
  activity: string | null;
  region: string | null;
  address: string | null;
  revenue: number | null;
  headcount: string | null;
  linkedin_url: string | null;
  notes: string | null;
  /** Identité fiscale : requise pour créer le client chez Pennylane. */
  siret: string | null;
  vat_number: string | null;
  billing_address: string | null;
  billing_email: string | null;
  pennylane_customer_id: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Contact = {
  id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  /** Colonne générée : `first_name` + `last_name`. */
  full_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  notes: string | null;
  is_primary: boolean;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  company_website: string | null;
  company_activity: string | null;
  company_legal_name: string | null;
  company_linkedin_url: string | null;
  company_description: string | null;
  job_title: string | null;
  /** Ligne standard : distincte du portable, on ne les compose pas dans le même ordre. */
  phone_standard: string | null;
  siren: string | null;
  siret: string | null;
  headcount: number | null;
  headcount_range: string | null;
  founded_year: number | null;
  revenue_year: number | null;
  /** Fiabilité annoncée par la source : un e-mail douteux ne se brûle qu'une fois. */
  email_quality: string | null;
  sector: string | null;
  region: string | null;
  address: string | null;
  linkedin_url: string | null;
  revenue: number | null;
  status: LeadStatus;
  /**
   * Nombre d'appels sans réponse, de 1 à 9.
   *
   * Zéro hors du statut NRP : le déclencheur le remet d'aplomb, de sorte qu'un
   * lead repassé en NRP six mois plus tard ne reprenne pas au compte de
   * l'époque.
   */
  nrp_count: number;
  /**
   * Clés de rattachement, calculées par la base.
   *
   * `org_key` : domaine e-mail professionnel, sinon domaine du site, sinon nom
   * d'entreprise réduit. `phone_key` : les neuf derniers chiffres du numéro.
   * Deux leads qui partagent l'une des deux parlent de la même organisation —
   * ou de la même personne.
   */
  org_key: string | null;
  phone_key: string | null;
  /** Tenus par un trigger : derniere activite reelle sur la fiche. */
  status_changed_at: string;
  last_touched_at: string | null;
  touch_count: number;
  owner_name: string | null;
  owner_id: string | null;
  comment: string | null;
  follow_up_on: string | null;
  source: string | null;
  segment: string | null;
  converted_at: string | null;
  converted_deal_id: string | null;
  converted_contact_id: string | null;
  converted_company_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Les colonnes que l'écran des leads charge réellement.
 *
 * La table en compte une quarantaine, dont une bonne part n'est là que pour
 * l'analyse : description du site, raison sociale, année de fondation. Les
 * envoyer au navigateur pour 432 fiches coûtait 233 ko à chaque ouverture,
 * sans que rien ne les affiche. Ce type dit lesquelles voyagent, et le
 * compilateur refuse qu'on en lise une autre côté client.
 */
/**
 * Les colonnes d'un lead qu'une main peut écrire.
 *
 * Tout le reste de la table est tenu ailleurs, et l'écrire ici le mettrait en
 * contradiction avec ce qui le produit : `org_key` et `phone_key` sont
 * calculées par la base, `status_changed_at`, `last_touched_at` et
 * `touch_count` par un déclencheur, `nrp_count` par le bouton « +1 », les
 * colonnes `converted_*` par la conversion en affaire.
 *
 * C'est une liste blanche, pas une documentation : les arguments d'une action
 * serveur arrivent par le réseau, et rien ne garantit qu'ils ressemblent à ce
 * que le formulaire a envoyé.
 */
export type LeadModifiable = Pick<
  Lead,
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "email_quality"
  | "phone"
  | "phone_standard"
  | "job_title"
  | "linkedin_url"
  | "company_name"
  | "company_legal_name"
  | "company_website"
  | "company_linkedin_url"
  | "company_activity"
  | "company_description"
  | "sector"
  | "segment"
  | "region"
  | "address"
  | "siren"
  | "siret"
  | "headcount"
  | "headcount_range"
  | "founded_year"
  | "revenue"
  | "revenue_year"
  | "source"
  | "status"
  | "comment"
  | "follow_up_on"
  | "owner_id"
>;

export type LeadListe = Omit<
  Lead,
  | "company_legal_name"
  | "company_linkedin_url"
  | "company_description"
  | "founded_year"
  | "revenue_year"
  | "email_quality"
  | "sector"
  | "address"
  | "source"
  | "converted_contact_id"
  | "converted_company_id"
>;

export type Deal = {
  id: string;
  name: string;
  company_id: string | null;
  contact_id: string | null;
  stage: DealStage;
  amount: number | null;
  probability: number | null;
  owner_id: string | null;
  expected_close_on: string | null;
  next_step: string | null;
  next_step_on: string | null;
  description: string | null;
  lost_reason: string | null;
  source_lead_id: string | null;
  position: number;
  stage_changed_at: string;
  won_at: string | null;
  lost_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Project = {
  id: string;
  code: string | null;
  name: string;
  deal_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  status: ProjectStatus;
  description: string | null;
  start_on: string | null;
  due_on: string | null;
  budget: number | null;
  owner_id: string | null;
  health: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectMember = {
  project_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export type Task = {
  id: string;
  project_id: string;
  milestone_id: string | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_on: string | null;
  start_on: string | null;
  completed_at: string | null;
  assignee_id: string | null;
  position: number;
  is_client_visible: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentRow = {
  id: string;
  project_id: string | null;
  deal_id: string | null;
  company_id: string | null;
  name: string;
  kind: DocumentKind;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_client_visible: boolean;
  uploaded_by: string | null;
  created_at: string;
}

export type Comment = {
  id: string;
  entity_type: EntityKind;
  entity_id: string;
  project_id: string | null;
  body: string;
  author_id: string;
  is_client_visible: boolean;
  created_at: string;
  updated_at: string;
}

export type Activity = {
  id: string;
  entity_type: EntityKind;
  entity_id: string;
  project_id: string | null;
  action: string;
  payload: Json;
  actor_id: string | null;
  created_at: string;
}

export type EmailMessage = {
  id: string;
  deal_id: string | null;
  project_id: string | null;
  contact_id: string | null;
  provider: string;
  provider_message_id: string | null;
  thread_id: string | null;
  direction: "inbound" | "outbound" | null;
  from_email: string | null;
  to_emails: string[] | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  sent_at: string | null;
  synced_by: string | null;
  created_at: string;
}

export type GoogleAccount = {
  user_id: string;
  email: string;
  /** Jeton de rafraîchissement : colonne fermée au rôle `authenticated`. */
  refresh_token: string;
  scope: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  synced_count: number;
  connected_at: string;
  created_at: string;
}

export type PipelineInsight = {
  id: string;
  headline: string;
  horizon_days: number;
  priorities: Json;
  reasoning: string | null;
  snapshot: Json;
  created_by: string | null;
  created_at: string;
}

export type CallKind =
  | "r1" | "r2" | "decouverte" | "demo" | "closing" | "suivi" | "interne" | "non_qualifie";

export type CallRecord = {
  id: string;
  provider: string;
  provider_call_id: string;
  deal_id: string | null;
  /** Après la signature, les échanges relèvent du projet, pas de l'affaire. */
  project_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  title: string | null;
  url: string | null;
  occurred_on: string | null;
  duration_minutes: number | null;
  kind: CallKind | null;
  folder_title: string | null;
  has_external: boolean;
  participants: Json;
  /** Resume produit par le fournisseur, tel quel. */
  summary: string | null;
  /** Fiche structuree tiree du resume, pour comparer les calls entre eux. */
  insights: Json;
  insights_model: string | null;
  insights_at: string | null;
  raw_payload: Json;
  synced_by: string | null;
  created_at: string;
}

export type CallInbox = {
  id: string;
  provider: string;
  provider_call_id: string;
  title: string | null;
  url: string | null;
  occurred_on: string | null;
  participants: Json;
  suggested_company: string | null;
  folder_title: string | null;
  status: "en_attente" | "traite" | "ignore";
  resolved_deal_id: string | null;
  resolved_project_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  raw_payload: Json;
  created_at: string;
}

export type LeadEvent = {
  id: string;
  lead_id: string;
  kind: string;
  from_status: LeadStatus | null;
  to_status: LeadStatus | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

export type CallKindRule = {
  id: string;
  folder_title: string;
  kind: CallKind;
  created_at: string;
}

export type WebhookEvent = {
  id: string;
  source: string;
  outcome: string;
  detail: string | null;
  headers: Json;
  body: Json;
  body_text: string | null;
  created_at: string;
}

export type DailySuggestion = {
  id: string;
  for_date: string;
  focus: string | null;
  items: Json;
  model: string | null;
  created_at: string;
}

export type SuggestionDone = {
  suggestion_date: string;
  item_key: string;
  user_id: string;
  done_at: string;
}

export type AppSetting = {
  key: string;
  value: Json;
  updated_at: string;
}

export type DossierStatus =
  | "brouillon" | "devis_envoye" | "devis_signe" | "en_facturation" | "solde" | "annule";

export type InvoiceStatus = "prevue" | "emise" | "payee" | "annulee";

/**
 * Où en est la relecture humaine, indépendamment du statut commercial.
 * Rien ne part au client sans être passé par « brouillon_pousse ».
 */
export type ReviewState = "a_preparer" | "a_valider" | "brouillon_pousse" | "envoye";

/** Le réel administratif, là où l'affaire est le théorique commercial. */
export type Dossier = {
  id: string;
  code: string | null;
  deal_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  project_id: string | null;
  status: DossierStatus;
  amount_ht: number;
  vat_rate: number;
  /** Colonne générée. */
  amount_ttc: number;
  payment_terms_days: number;
  pennylane_customer_id: string | null;
  pennylane_quote_id: string | null;
  quote_url: string | null;
  quote_sent_at: string | null;
  quote_signed_at: string | null;
  quote_review: ReviewState;
  quote_pushed_at: string | null;
  last_sync_error: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DossierLine = {
  id: string;
  dossier_id: string;
  label: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
  position: number;
  created_at: string;
}

/** Une échéance planifiée devient une facture émise : même ligne, statut qui avance. */
export type Invoice = {
  id: string;
  dossier_id: string;
  label: string;
  amount_ht: number;
  vat_rate: number;
  amount_ttc: number;
  status: InvoiceStatus;
  due_on: string | null;
  issued_on: string | null;
  paid_on: string | null;
  paid_amount: number;
  pennylane_invoice_id: string | null;
  invoice_number: string | null;
  invoice_url: string | null;
  review: ReviewState;
  pushed_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export type PennylaneEvent = {
  id: string;
  direction: "sortant" | "entrant";
  operation: string;
  dossier_id: string | null;
  invoice_id: string | null;
  http_status: number | null;
  ok: boolean;
  request: Json;
  response: Json;
  detail: string | null;
  created_at: string;
}

export type DossierFinance = {
  dossier_id: string | null;
  code: string | null;
  status: DossierStatus | null;
  amount_ht: number | null;
  amount_ttc: number | null;
  facture_ttc: number | null;
  encaisse_ttc: number | null;
  en_attente_ttc: number | null;
  a_facturer_ttc: number | null;
  en_retard_ttc: number | null;
  prochaine_echeance: string | null;
}

export type ProjectProgress = {
  project_id: string | null;
  tasks_total: number | null;
  tasks_done: number | null;
  milestones_total: number | null;
  milestones_done: number | null;
  tasks_overdue: number | null;
  next_due_on: string | null;
  progress_pct: number | null;
}

/* --- Pilotage de la boîte ------------------------------------------------ */

export type ChantierStatus = "actif" | "en_pause" | "termine";

/**
 * D'où vient le chiffre d'un objectif.
 *
 * `manuel` oblige à saisir la valeur ; les autres se calculent depuis les
 * données déjà présentes dans le CRM. Le principe : ne jamais demander à la
 * main un nombre que l'application sait compter elle-même.
 */
export type MetricSource =
  | "manuel"
  | "rdv_pris"
  | "affaires_gagnees"
  | "ca_facture"
  | "ca_encaisse"
  | "leads_contactes";

export type Chantier = {
  id: string;
  title: string;
  intention: string | null;
  owner_id: string | null;
  status: ChantierStatus;
  color: string | null;
  position: number;
  started_on: string;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Objectif = {
  id: string;
  chantier_id: string;
  title: string;
  rationale: string | null;
  target_value: number;
  current_value: number;
  unit: string | null;
  source: MetricSource;
  starts_on: string;
  due_on: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Combien de jours une affaire peut rester dans une étape avant d'être
 * considérée dormante. Le seuil vit en base et non dans le code : c'est un
 * réglage commercial, il doit pouvoir bouger sans redéploiement.
 */
export type DealActivityRule = {
  stage: DealStage;
  max_days_active: number;
  note: string | null;
}

export type DealHealth = {
  deal_id: string | null;
  stage: DealStage | null;
  amount: number | null;
  jours_dans_etape: number | null;
  max_days_active: number | null;
  sante: "actif" | "dormant" | "clos" | null;
}

/* --- Tri de la boîte mail ------------------------------------------------ */

export type MailCategory =
  | "spam"
  | "prospection_etrangere"
  /** Transactionnel et automatique : rien à répondre, rien à décider. */
  | "notification"
  | "facture"
  | "a_repondre"
  | "information"
  | "incertain";

export type MailAction = "corbeille" | "etiquete" | "brouillon_pret" | "a_traiter";
export type MailReview = "en_attente" | "traite" | "ignore";

export type MailTriage = {
  id: string;
  user_id: string;
  /**
   * Le passage de tri qui a produit cette ligne.
   *
   * Nul pour les mails antérieurs à l'introduction de la colonne, et nul aussi
   * si le passage a été effacé par la péremption avant le mail — d'où le
   * `on delete set null` plutôt qu'une cascade : perdre le bilan d'un passage
   * ne doit pas faire disparaître ce qu'il a classé.
   */
  run_id: string | null;
  provider_message_id: string;
  thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  category: MailCategory;
  confidence: number;
  /** En français : c'est ce qui permet de contester un classement. */
  reason: string | null;
  action: MailAction;
  label_applied: string | null;
  /**
   * L'expéditeur était-il déjà dans le CRM ? Calculé avant l'appel au modèle,
   * ce drapeau interdit la mise à la corbeille — un contact connu ne disparaît
   * jamais, quelle que soit la confiance annoncée.
   */
  known_contact: boolean;
  /** Écarté, mais à porter à la connaissance : alerte de sécurité, impayé. */
  a_signaler: boolean;
  draft_id: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  /** Ce qui manquait pour rédiger, dit franchement plutôt que bâclé. */
  draft_blocked_reason: string | null;
  review: MailReview;
  handled_at: string | null;
  handled_by: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MailRun = {
  id: string;
  user_id: string;
  started_at: string;
  finished_at: string | null;
  lus: number;
  spams: number;
  factures: number;
  brouillons: number;
  a_traiter: number;
  incertains: number;
  cout_centimes: number;
  erreur: string | null;
  annonce: boolean;
}

/* --- Retours sur ce que l'IA propose ------------------------------------- */

export type AiKind =
  | "suggestion"
  | "insight"
  | "mail_tri"
  | "mail_brouillon"
  | "import_nettoyage";

export type AiFeedback = {
  id: string;
  kind: AiKind;
  /** Identifiant de ce qui est jugé : une ligne, ou la clef d'une suggestion. */
  ref: string | null;
  utile: boolean;
  /** La raison compte plus que le pouce : c'est elle qui dira quoi corriger. */
  note: string | null;
  user_id: string;
  created_at: string;
}

export type AiFeedbackBilan = {
  kind: AiKind | null;
  juges: number | null;
  utiles: number | null;
  taux_utile: number | null;
  dernier: string | null;
}

/** Colonnes à valeur par défaut côté base, donc optionnelles à l'insertion. */
type Defaulted =
  | "id" | "created_at" | "updated_at" | "connected_at" | "synced_count"
  | "for_date" | "done_at" | "status_changed_at" | "touch_count"
  | "amount_ttc" | "paid_amount" | "position" | "vat_rate"
  | "quote_review" | "review" | "ok"
  | "started_on" | "starts_on" | "target_value" | "current_value" | "source"
  | "org_key" | "phone_key" | "utile"
  | "started_at" | "confidence" | "known_contact" | "action" | "a_signaler" | "lus" | "spams"
  | "factures" | "brouillons" | "a_traiter" | "incertains" | "cout_centimes" | "annonce";

type TableDef<Row, RequiredKeys extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Omit<Row, Defaulted>> & Pick<Row, RequiredKeys> & Partial<Pick<Row, Extract<Defaulted, keyof Row>>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<Profile, "id" | "email">;
      companies: TableDef<Company, "name">;
      contacts: TableDef<Contact>;
      leads: TableDef<Lead>;
      deals: TableDef<Deal, "name">;
      projects: TableDef<Project, "name">;
      project_members: TableDef<ProjectMember, "project_id" | "user_id">;
      tasks: TableDef<Task, "project_id" | "title">;
      documents: TableDef<DocumentRow, "name" | "storage_path">;
      comments: TableDef<Comment, "entity_type" | "entity_id" | "body" | "author_id">;
      activities: TableDef<Activity, "entity_type" | "entity_id" | "action">;
      email_messages: TableDef<EmailMessage>;
      pipeline_insights: TableDef<PipelineInsight, "headline">;
      google_accounts: TableDef<GoogleAccount, "user_id" | "email" | "refresh_token">;
      daily_suggestions: TableDef<DailySuggestion, "items">;
      suggestion_done: TableDef<SuggestionDone, "suggestion_date" | "item_key" | "user_id">;
      call_records: TableDef<CallRecord, "provider_call_id">;
      call_inbox: TableDef<CallInbox, "provider_call_id">;
      lead_events: TableDef<LeadEvent, "lead_id" | "kind">;
      call_kind_rules: TableDef<CallKindRule, "folder_title" | "kind">;
      webhook_events: TableDef<WebhookEvent, "source" | "outcome">;
      dossiers: TableDef<Dossier>;
      dossier_lines: TableDef<DossierLine, "dossier_id" | "label">;
      invoices: TableDef<Invoice, "dossier_id" | "label">;
      pennylane_events: TableDef<PennylaneEvent, "direction" | "operation">;
      chantiers: TableDef<Chantier, "title">;
      objectifs: TableDef<Objectif, "chantier_id" | "title">;
      deal_activity_rules: TableDef<DealActivityRule, "stage" | "max_days_active">;
      app_settings: TableDef<AppSetting, "key" | "value">;
      mail_triage: TableDef<MailTriage, "user_id" | "provider_message_id" | "category">;
      mail_runs: TableDef<MailRun, "user_id">;
      ai_feedback: TableDef<AiFeedback, "kind" | "utile" | "user_id">;
    };
    Views: {
      project_progress: { Row: ProjectProgress; Relationships: [] };
      dossier_finance: { Row: DossierFinance; Relationships: [] };
      deal_health: { Row: DealHealth; Relationships: [] };
      ai_feedback_bilan: { Row: AiFeedbackBilan; Relationships: [] };
    };
    Functions: {
      convert_lead_to_deal: {
        Args: { p_lead_id: string; p_deal_name?: string; p_amount?: number; p_owner_id?: string };
        Returns: Json;
      };
      current_role: { Args: Record<string, never>; Returns: AppRole };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      my_company_id: { Args: Record<string, never>; Returns: string };
      client_can_see_project: { Args: { p_project_id: string }; Returns: boolean };
      client_can_see_dossier: { Args: { p_dossier_id: string }; Returns: boolean };
      purger_historique_mails: {
        Args: { jours?: number };
        Returns: Array<{ passages_supprimes: number; mails_supprimes: number }>;
      };
    };
    Enums: {
      app_role: AppRole;
      lead_status: LeadStatus;
      deal_stage: DealStage;
      project_status: ProjectStatus;
      task_kind: TaskKind;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      document_kind: DocumentKind;
      call_kind: CallKind;
      dossier_status: DossierStatus;
      invoice_status: InvoiceStatus;
      review_state: ReviewState;
      entity_kind: EntityKind;
      chantier_status: ChantierStatus;
      metric_source: MetricSource;
      mail_category: MailCategory;
      mail_action: MailAction;
      mail_review: MailReview;
      ai_kind: AiKind;
    };
    CompositeTypes: Record<string, never>;
  };
};

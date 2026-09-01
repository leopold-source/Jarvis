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
  | "nouveau"
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
  sector: string | null;
  region: string | null;
  address: string | null;
  linkedin_url: string | null;
  revenue: number | null;
  status: LeadStatus;
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

/** Colonnes à valeur par défaut côté base, donc optionnelles à l'insertion. */
type Defaulted = "id" | "created_at" | "updated_at";

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
    };
    Views: {
      project_progress: { Row: ProjectProgress; Relationships: [] };
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
      entity_kind: EntityKind;
    };
    CompositeTypes: Record<string, never>;
  };
};

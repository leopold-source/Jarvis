-- =============================================================================
-- Antichaos CRM — Projets, tâches / jalons, documents, commentaires, activités
-- =============================================================================

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,
  name         text not null,
  deal_id      uuid unique references public.deals (id) on delete set null,
  company_id   uuid references public.companies (id) on delete set null,
  contact_id   uuid references public.contacts (id) on delete set null,
  status       public.project_status not null default 'cadrage',
  description  text,
  start_on     date,
  due_on       date,
  budget       numeric(14, 2),
  -- Chef de projet.
  owner_id     uuid references public.profiles (id) on delete set null,
  health       text check (health in ('vert', 'orange', 'rouge')) default 'vert',
  closed_at    timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index projects_company_idx on public.projects (company_id);
create index projects_owner_idx on public.projects (owner_id);
create index projects_status_idx on public.projects (status);

-- Équipe interne affectée au projet (en plus du chef de projet).
create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'contributeur',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- --- Tâches et jalons ---------------------------------------------------
-- Un jalon (kind = 'jalon') matérialise un moment clé du projet ; les tâches
-- de production peuvent lui être rattachées via milestone_id, ce qui donne une
-- timeline lisible côté client sans exposer le détail opérationnel.
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  milestone_id   uuid references public.tasks (id) on delete set null,
  kind           public.task_kind not null default 'production',
  title          text not null,
  description    text,
  status         public.task_status not null default 'a_faire',
  priority       public.task_priority not null default 'normale',
  due_on         date,
  start_on       date,
  completed_at   timestamptz,
  assignee_id    uuid references public.profiles (id) on delete set null,
  position       double precision not null default 1000,
  -- Visible dans le portail client (les jalons le sont par défaut).
  is_client_visible boolean not null default false,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint tasks_milestone_not_self check (milestone_id is null or milestone_id <> id)
);

create index tasks_project_idx on public.tasks (project_id, status, position);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_due_idx on public.tasks (due_on);
create index tasks_milestone_idx on public.tasks (milestone_id);

create or replace function public.tasks_track_completion()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'termine' and coalesce(old.status, 'a_faire') <> 'termine' then
    new.completed_at = coalesce(new.completed_at, now());
  elsif new.status <> 'termine' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_track_completion_trg before insert or update on public.tasks
  for each row execute function public.tasks_track_completion();

-- Un jalon est par défaut partagé avec le client.
create or replace function public.tasks_default_visibility()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.kind = 'jalon' then
    new.is_client_visible = true;
  end if;
  return new;
end;
$$;

create trigger tasks_default_visibility_trg before insert on public.tasks
  for each row execute function public.tasks_default_visibility();

-- --- Documents ----------------------------------------------------------
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.projects (id) on delete cascade,
  deal_id      uuid references public.deals (id) on delete cascade,
  company_id   uuid references public.companies (id) on delete cascade,
  name         text not null,
  kind         public.document_kind not null default 'autre',
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  is_client_visible boolean not null default false,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint documents_has_parent check (
    project_id is not null or deal_id is not null or company_id is not null
  )
);

create index documents_project_idx on public.documents (project_id);
create index documents_deal_idx on public.documents (deal_id);

-- --- Commentaires -------------------------------------------------------
-- entity_id pointe vers un deal, un projet ou une tâche. project_id est
-- dénormalisé pour permettre une policy RLS client simple et indexée.
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  entity_type public.entity_kind not null,
  entity_id   uuid not null,
  project_id  uuid references public.projects (id) on delete cascade,
  body        text not null,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  is_client_visible boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index comments_entity_idx on public.comments (entity_type, entity_id, created_at desc);
create index comments_project_idx on public.comments (project_id);

-- --- Journal d'activité -------------------------------------------------
create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  entity_type public.entity_kind not null,
  entity_id   uuid not null,
  project_id  uuid references public.projects (id) on delete cascade,
  action      text not null,
  payload     jsonb not null default '{}'::jsonb,
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index activities_entity_idx on public.activities (entity_type, entity_id, created_at desc);

-- --- Emails (socle pour la synchronisation Gmail en V2) -----------------
create table public.email_messages (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid references public.deals (id) on delete cascade,
  project_id     uuid references public.projects (id) on delete cascade,
  contact_id     uuid references public.contacts (id) on delete set null,
  provider       text not null default 'gmail',
  provider_message_id text,
  thread_id      text,
  direction      text check (direction in ('inbound', 'outbound')),
  from_email     text,
  to_emails      text[],
  subject        text,
  snippet        text,
  body_text      text,
  sent_at        timestamptz,
  synced_by      uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (provider, provider_message_id)
);

create index email_messages_deal_idx on public.email_messages (deal_id, sent_at desc);

-- Jetons OAuth Google par utilisateur (jamais exposés au client : RLS stricte).
create table public.google_accounts (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  email         text not null,
  refresh_token text not null,
  scope         text,
  last_synced_at timestamptz,
  created_at    timestamptz not null default now()
);

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
create trigger comments_touch before update on public.comments
  for each row execute function public.touch_updated_at();

-- --- Création automatique du projet quand une affaire est gagnée --------
create or replace function public.deals_spawn_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
  v_code text;
begin
  if new.stage = 'gagne' and old.stage is distinct from 'gagne' then
    select id into v_project_id from public.projects where deal_id = new.id;
    if v_project_id is null then
      v_code := 'P-' || to_char(now(), 'YYYY') || '-' ||
                lpad((select count(*) + 1 from public.projects)::text, 3, '0');

      insert into public.projects
        (code, name, deal_id, company_id, contact_id, status, budget, owner_id, created_by, start_on)
      values
        (v_code, new.name, new.id, new.company_id, new.contact_id, 'cadrage',
         new.amount, new.owner_id, new.owner_id, current_date)
      returning id into v_project_id;

      insert into public.activities (entity_type, entity_id, project_id, action, payload, actor_id)
      values ('project', v_project_id, v_project_id, 'project.created_from_deal',
              jsonb_build_object('deal_id', new.id, 'deal_name', new.name), auth.uid());
    end if;
  end if;
  return new;
end;
$$;

create trigger deals_spawn_project_trg after update on public.deals
  for each row execute function public.deals_spawn_project();

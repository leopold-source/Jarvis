-- Traçabilité des leads et rattachement des calls Claap aux affaires.

-- --- Leads : savoir quand on a touché le lead pour la dernière fois --------
alter table public.leads
  add column if not exists status_changed_at  timestamptz not null default now(),
  add column if not exists last_touched_at    timestamptz,
  add column if not exists touch_count        integer not null default 0;

create table if not exists public.lead_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  kind        text not null,
  from_status public.lead_status,
  to_status   public.lead_status,
  note        text,
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at desc);
alter table public.lead_events enable row level security;

create policy "lead_events_select_staff" on public.lead_events
  for select to authenticated using (public.is_staff());
create policy "lead_events_insert_staff" on public.lead_events
  for insert to authenticated with check (public.is_staff());

-- Le suivi est tenu par la base, pas par l'application : toute écriture, d'où
-- qu'elle vienne (interface, import, script), alimente le même journal.
create or replace function public.leads_track_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.last_touched_at   := now();
    new.touch_count       := coalesce(old.touch_count, 0) + 1;

    insert into public.lead_events (lead_id, kind, from_status, to_status, actor_id)
    values (new.id, 'statut', old.status, new.status, auth.uid());

  elsif new.comment is distinct from old.comment and new.comment is not null then
    -- Un compte rendu d'appel vaut contact, même sans changement de statut.
    new.last_touched_at := now();

    insert into public.lead_events (lead_id, kind, note, actor_id)
    values (new.id, 'commentaire', left(new.comment, 500), auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists leads_track_activity on public.leads;
create trigger leads_track_activity before update on public.leads
  for each row execute function public.leads_track_activity();

revoke execute on function public.leads_track_activity() from public, anon, authenticated;

-- --- Calls Claap ------------------------------------------------------------
do $$ begin
  create type public.call_kind as enum
    ('r1', 'r2', 'decouverte', 'demo', 'closing', 'suivi', 'interne', 'non_qualifie');
exception when duplicate_object then null; end $$;

create table if not exists public.call_records (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'claap',
  provider_call_id  text not null,
  deal_id           uuid references public.deals (id) on delete cascade,
  company_id        uuid references public.companies (id) on delete set null,
  contact_id        uuid references public.contacts (id) on delete set null,
  title             text,
  url               text,
  occurred_on       date,
  duration_minutes  integer,
  kind              public.call_kind,
  -- Un échange sans interlocuteur externe est une réunion interne : la
  -- distinction change tout quand on compte les calls d'une affaire.
  has_external      boolean not null default false,
  participants      jsonb not null default '[]'::jsonb,
  summary           text,
  raw_payload       jsonb,
  synced_by         uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (provider, provider_call_id)
);

create index if not exists call_records_deal_idx on public.call_records (deal_id, occurred_on desc);
create index if not exists call_records_company_idx on public.call_records (company_id, occurred_on desc);
alter table public.call_records enable row level security;

create policy "call_records_select_staff" on public.call_records
  for select to authenticated using (public.is_staff());
create policy "call_records_write_staff" on public.call_records
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- File d'attente des calls non rattachés : plutôt que de deviner, on demande.
create table if not exists public.call_inbox (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'claap',
  provider_call_id  text not null,
  title             text,
  url               text,
  occurred_on       date,
  participants      jsonb not null default '[]'::jsonb,
  suggested_company text,
  status            text not null default 'en_attente'
                    check (status in ('en_attente', 'traite', 'ignore')),
  resolved_deal_id  uuid references public.deals (id) on delete set null,
  resolved_by       uuid references public.profiles (id) on delete set null,
  resolved_at       timestamptz,
  raw_payload       jsonb,
  created_at        timestamptz not null default now(),
  unique (provider, provider_call_id)
);

create index if not exists call_inbox_pending_idx
  on public.call_inbox (status, created_at desc) where status = 'en_attente';
alter table public.call_inbox enable row level security;

create policy "call_inbox_select_staff" on public.call_inbox
  for select to authenticated using (public.is_staff());
create policy "call_inbox_write_staff" on public.call_inbox
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- --- Qualification des calls : une donnée, pas une règle du code -----------
-- Chacun range ses dossiers Claap comme il veut, et personne ne range tout.
-- Les correspondances vivent donc en base, modifiables sans redéploiement ;
-- l'absence de règle laisse simplement le call à qualifier à la main.
create table if not exists public.call_kind_rules (
  id           uuid primary key default gen_random_uuid(),
  folder_title text not null,
  kind         public.call_kind not null,
  created_at   timestamptz not null default now()
);

create unique index if not exists call_kind_rules_folder_idx
  on public.call_kind_rules (lower(folder_title));

alter table public.call_kind_rules enable row level security;

create policy "call_kind_rules_select_staff" on public.call_kind_rules
  for select to authenticated using (public.is_staff());
create policy "call_kind_rules_write_admin" on public.call_kind_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Le dossier d'origine est conservé brut : il permet de rejouer un étiquetage
-- après avoir changé les règles.
alter table public.call_records add column if not exists folder_title text;
alter table public.call_inbox   add column if not exists folder_title text;

-- Journal des appels entrants : sans lui, un webhook refusé ou illisible ne
-- laisse aucune trace et le diagnostic devient une devinette.
create table if not exists public.webhook_events (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  outcome     text not null,
  detail      text,
  headers     jsonb,
  body        jsonb,
  body_text   text,
  created_at  timestamptz not null default now()
);

create index if not exists webhook_events_recent_idx
  on public.webhook_events (source, created_at desc);

alter table public.webhook_events enable row level security;

create policy "webhook_events_select_admin" on public.webhook_events
  for select to authenticated using (public.is_admin());

-- --- Un call ne relève pas toujours d'une affaire ---------------------------
-- Après la signature, les échanges sont de la production : ils appartiennent
-- au projet. Sans cette distinction, le compteur de calls d'une affaire signée
-- gonflerait indéfiniment et fausserait la lecture du cycle commercial.
alter table public.call_records
  add column if not exists project_id uuid references public.projects (id) on delete cascade;

create index if not exists call_records_project_idx
  on public.call_records (project_id, occurred_on desc);

-- Un call rattaché nulle part n'a rien à faire dans cette table : il reste
-- dans la file d'attente jusqu'à ce qu'on tranche.
alter table public.call_records drop constraint if exists call_records_cible;
alter table public.call_records add constraint call_records_cible
  check (deal_id is not null or project_id is not null);

alter table public.call_inbox
  add column if not exists resolved_project_id uuid references public.projects (id) on delete set null;

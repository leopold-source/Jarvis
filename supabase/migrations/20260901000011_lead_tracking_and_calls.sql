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

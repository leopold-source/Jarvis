-- =============================================================================
-- Antichaos CRM — Leads, entreprises, contacts, affaires
-- =============================================================================

-- --- Entreprises --------------------------------------------------------
create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  website        text,
  sector         text,
  activity       text,
  region         text,
  address        text,
  revenue        numeric(14, 2),
  headcount      text,
  linkedin_url   text,
  notes          text,
  owner_id       uuid references public.profiles (id) on delete set null,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index companies_name_idx on public.companies (lower(name));
create index companies_owner_idx on public.companies (owner_id);

alter table public.profiles
  add constraint profiles_company_fk
  foreign key (company_id) references public.companies (id) on delete set null;

-- --- Contacts -----------------------------------------------------------
create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies (id) on delete set null,
  first_name   text,
  last_name    text,
  full_name    text generated always as (
                 trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
               ) stored,
  email        text,
  phone        text,
  job_title    text,
  linkedin_url text,
  notes        text,
  is_primary   boolean not null default false,
  owner_id     uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index contacts_company_idx on public.contacts (company_id);
create index contacts_email_idx on public.contacts (lower(email));

-- --- Leads --------------------------------------------------------------
-- Table de prospection amont : des gens à contacter, pas encore de deal.
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  first_name       text,
  last_name        text,
  full_name        text,
  email            text,
  phone            text,
  company_name     text,
  company_website  text,
  company_activity text,
  sector           text,
  region           text,
  address          text,
  linkedin_url     text,
  revenue          numeric(14, 2),
  status           public.lead_status not null default 'nouveau',
  owner_name       text,
  owner_id         uuid references public.profiles (id) on delete set null,
  comment          text,
  follow_up_on     date,
  source           text,
  -- Renseignés lorsque le lead passe en « call pris » et est converti.
  converted_at     timestamptz,
  converted_deal_id uuid,
  converted_contact_id uuid references public.contacts (id) on delete set null,
  converted_company_id uuid references public.companies (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index leads_status_idx on public.leads (status);
create index leads_owner_idx on public.leads (owner_id);
create index leads_follow_up_idx on public.leads (follow_up_on);
create index leads_search_idx on public.leads
  using gin (to_tsvector('simple',
    coalesce(full_name, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(email, '')));

-- --- Affaires -----------------------------------------------------------
create table public.deals (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  company_id     uuid references public.companies (id) on delete set null,
  contact_id     uuid references public.contacts (id) on delete set null,
  stage          public.deal_stage not null default 'demande_rdv_envoyee',
  amount         numeric(14, 2),
  probability    smallint check (probability between 0 and 100),
  owner_id       uuid references public.profiles (id) on delete set null,
  expected_close_on date,
  next_step      text,
  next_step_on   date,
  description    text,
  lost_reason    text,
  source_lead_id uuid references public.leads (id) on delete set null,
  -- Position dans la colonne Kanban (tri manuel par drag & drop).
  position       double precision not null default 1000,
  stage_changed_at timestamptz not null default now(),
  won_at         timestamptz,
  lost_at        timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index deals_stage_idx on public.deals (stage, position);
create index deals_company_idx on public.deals (company_id);
create index deals_owner_idx on public.deals (owner_id);

alter table public.leads
  add constraint leads_converted_deal_fk
  foreign key (converted_deal_id) references public.deals (id) on delete set null;

-- Horodate les changements d'étape et alimente les dates gagné / perdu.
create or replace function public.deals_track_stage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at = now();
    if new.stage = 'gagne' then
      new.won_at = coalesce(new.won_at, now());
      new.probability = 100;
    elsif new.stage in ('perdu', 'non_qualifie') then
      new.lost_at = coalesce(new.lost_at, now());
      new.probability = 0;
    end if;
  end if;
  return new;
end;
$$;

create trigger deals_track_stage_trg before update on public.deals
  for each row execute function public.deals_track_stage();

create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();
create trigger deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();

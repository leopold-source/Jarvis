-- =============================================================================
-- Antichaos CRM — Coeur du schéma : types, profils, helpers RLS
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- --- Types --------------------------------------------------------------
create type public.app_role as enum ('admin', 'member', 'client');

create type public.lead_status as enum (
  'nouveau',
  'a_contacter',
  'nrp',
  'nrp2',
  'nrp3',
  'raccroche_avant_pitch',
  'a_recontacter',
  'pas_interesse',
  'non_qualifie',
  'call_pris'
);

create type public.deal_stage as enum (
  'demande_rdv_envoyee',
  'r1',
  'r2',
  'propale_envoyee',
  'no_show',
  'nurturing',
  'gagne',
  'perdu',
  'non_qualifie'
);

create type public.project_status as enum ('cadrage', 'en_cours', 'en_pause', 'livre', 'cloture');
create type public.task_kind    as enum ('production', 'jalon');
create type public.task_status  as enum ('a_faire', 'en_cours', 'en_revue', 'termine', 'bloque');
create type public.task_priority as enum ('basse', 'normale', 'haute', 'critique');
create type public.document_kind as enum ('devis', 'contrat', 'livrable', 'brief', 'facture', 'autre');
create type public.entity_kind   as enum ('lead', 'company', 'contact', 'deal', 'project', 'task');

-- --- Profils ------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  job_title   text,
  role        public.app_role not null default 'member',
  -- Renseigné uniquement pour les comptes clients : rattache l'utilisateur à
  -- l'entreprise dont il pourra consulter les projets.
  company_id  uuid,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);
create index profiles_company_idx on public.profiles (company_id);

-- --- Helpers RLS --------------------------------------------------------
-- SECURITY DEFINER pour éviter la récursion infinie des policies sur profiles.
create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- Collaborateur interne : admin ou membre.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role in ('admin', 'member') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- --- updated_at ---------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- --- Création automatique du profil à l'inscription ---------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  -- Le rôle peut être pré-positionné dans les metadata lors d'une invitation.
  v_role := coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'member');

  insert into public.profiles (id, email, full_name, role, company_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    v_role,
    nullif(new.raw_user_meta_data ->> 'company_id', '')::uuid
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- RLS profiles -------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_self" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "profiles_select_staff" on public.profiles
  for select to authenticated using (public.is_staff());

create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role());

create policy "profiles_admin_all" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

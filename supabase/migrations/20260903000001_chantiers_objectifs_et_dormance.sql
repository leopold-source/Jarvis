-- Chantiers, objectifs, et la notion d'affaire dormante.
--
-- Trois idées, une seule migration parce qu'elles se tiennent :
--
-- 1. Un chantier est un sujet que l'on décide de faire avancer — la conduite
--    de la boîte, un cran au-dessus des affaires et des projets.
-- 2. Un chantier sans objectif chiffré n'est qu'une intention. L'objectif
--    porte la cible, mais aussi le « pourquoi ce chiffre » : c'est ce qui
--    permettra de relire une décision six mois plus tard.
-- 3. Une affaire sans mouvement depuis trop longtemps n'est pas perdue — la
--    déclarer morte serait faux et irréversible — mais la compter dans le
--    prévisionnel fausse la lecture. D'où un état dérivé, calculé, jamais saisi.

create type public.chantier_status as enum ('actif', 'en_pause', 'termine');

-- D'où vient le chiffre d'un objectif. `manuel` oblige à saisir la valeur ;
-- les autres se calculent depuis ce que le CRM sait déjà compter.
create type public.metric_source as enum (
  'manuel',
  'rdv_pris',
  'affaires_gagnees',
  'ca_facture',
  'ca_encaisse',
  'leads_contactes'
);

create table public.chantiers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  intention text,
  owner_id uuid references public.profiles (id) on delete set null,
  status public.chantier_status not null default 'actif',
  color text,
  position integer not null default 0,
  -- Le couple début / fin est conservé même une fois le chantier terminé :
  -- c'est lui qui permettra plus tard de mesurer combien de temps nous coûte
  -- réellement un chantier. Une suppression rendrait cette lecture impossible,
  -- donc un chantier terminé disparaît de l'écran, jamais de la base.
  started_on date not null default current_date,
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chantiers_status_idx on public.chantiers (status, position);

create table public.objectifs (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.chantiers (id) on delete cascade,
  title text not null,
  -- Le « pourquoi ce chiffre ». Sans lui, une cible n'est qu'un nombre dont
  -- personne ne sait plus, un trimestre plus tard, ce qui l'avait fixée là.
  rationale text,
  target_value numeric(12, 2) not null default 0,
  current_value numeric(12, 2) not null default 0,
  unit text,
  source public.metric_source not null default 'manuel',
  starts_on date not null default current_date,
  due_on date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index objectifs_chantier_idx on public.objectifs (chantier_id);

/* --- Dormance ------------------------------------------------------------ */

-- Le seuil vit en base et non dans le code : c'est un réglage commercial, il
-- doit pouvoir bouger sans redéploiement. Même leçon que les dossiers Claap.
create table public.deal_activity_rules (
  stage public.deal_stage primary key,
  max_days_active integer not null,
  note text
);

-- Les étapes absentes de cette table ne dorment jamais. C'est le cas du
-- no-show : un rendez-vous manqué est un process commercial engagé qui n'a pas
-- encore abouti, pas une affaire qui s'éteint — aucune propale n'a même été
-- envoyée.
insert into public.deal_activity_rules (stage, max_days_active, note) values
  ('demande_rdv_envoyee', 21, 'Sans reponse sous trois semaines, la demande est retombee.'),
  ('r1', 45, null),
  ('r2', 45, null),
  ('propale_envoyee', 60, 'Deux mois sans signature : statistiquement perdue.'),
  ('nurturing', 0, 'Le nurturing est dormant par definition.');

create or replace view public.deal_health with (security_invoker = on) as
select
  d.id as deal_id,
  d.stage,
  d.amount,
  (current_date - d.stage_changed_at::date) as jours_dans_etape,
  r.max_days_active,
  case
    when d.stage in ('gagne', 'perdu', 'non_qualifie') then 'clos'
    when r.max_days_active is null then 'actif'
    when (current_date - d.stage_changed_at::date) >= r.max_days_active then 'dormant'
    else 'actif'
  end as sante
from public.deals d
left join public.deal_activity_rules r on r.stage = d.stage;

/* --- Accès --------------------------------------------------------------- */

alter table public.chantiers enable row level security;
alter table public.objectifs enable row level security;
alter table public.deal_activity_rules enable row level security;

create policy chantiers_staff on public.chantiers
  for all using (public.is_staff()) with check (public.is_staff());

create policy objectifs_staff on public.objectifs
  for all using (public.is_staff()) with check (public.is_staff());

-- Tout le monde en interne lit les seuils ; seul un admin les change.
create policy deal_activity_rules_select_staff on public.deal_activity_rules
  for select using (public.is_staff());

create policy deal_activity_rules_write_admin on public.deal_activity_rules
  for all using (public.is_admin()) with check (public.is_admin());

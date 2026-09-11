-- Le tri quotidien de la boîte mail.
--
-- Deux principes gouvernent cette table, et ils expliquent sa forme :
--
-- 1. Rien n'est irréversible. Un spam part à la corbeille, jamais en
--    suppression définitive : Gmail la garde trente jours, et le périmètre
--    OAuth demandé ne permettrait pas davantage. Une réponse est préparée en
--    brouillon, jamais envoyée.
-- 2. Ce que l'IA n'a pas su trancher doit être visible, pas enfoui. D'où une
--    catégorie « incertain » de plein droit et une raison toujours écrite :
--    un tri qu'on ne peut pas relire est un tri auquel on ne peut pas se fier.

create type public.mail_category as enum (
  'spam',                  -- publicité non sollicitée, évidente
  'prospection_etrangere', -- démarchage, souvent hors de France
  'facture',               -- facture, reçu, justificatif comptable
  'a_repondre',            -- demande une réponse humaine
  'information',           -- à lire, sans action
  'incertain'              -- l'IA ne sait pas : c'est à vous de voir
);

create type public.mail_action as enum (
  'corbeille',       -- mis à la corbeille, récupérable
  'etiquete',        -- rangé sous une étiquette, laissé en boîte
  'brouillon_pret',  -- étiqueté, et une réponse attend votre relecture
  'a_traiter'        -- rien n'a été fait : l'IA vous le remonte
);

create type public.mail_review as enum ('en_attente', 'traite', 'ignore');

create table public.mail_triage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider_message_id text not null,
  thread_id text,

  from_email text,
  from_name text,
  subject text,
  snippet text,
  received_at timestamptz,

  category public.mail_category not null,
  confidence numeric(3, 2) not null default 0,
  -- En français, lisible : c'est ce qui permet de contester un classement.
  reason text,

  action public.mail_action not null default 'a_traiter',
  label_applied text,

  -- L'expéditeur est-il déjà dans le CRM ? Calculé avant l'IA, il sert de
  -- garde-fou : un contact connu n'est jamais mis à la corbeille, quelle que
  -- soit la confiance du modèle. C'est une règle de code, pas une consigne de
  -- prompt — une consigne se contourne, une condition non.
  known_contact boolean not null default false,

  draft_id text,
  draft_subject text,
  draft_body text,
  -- Ce que l'IA n'a pas su formuler, dit franchement plutôt que bâclé.
  draft_blocked_reason text,

  review public.mail_review not null default 'en_attente',
  handled_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, provider_message_id)
);

create index mail_triage_review_idx on public.mail_triage (user_id, review, received_at desc);
create index mail_triage_category_idx on public.mail_triage (category);

-- Le bilan d'un passage : c'est cette ligne que l'assistant vocal lit pour
-- annoncer « j'ai trié tes mails ». La recalculer à chaque question coûterait
-- une agrégation sur toute la table pour une phrase.
create table public.mail_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lus integer not null default 0,
  spams integer not null default 0,
  factures integer not null default 0,
  brouillons integer not null default 0,
  a_traiter integer not null default 0,
  incertains integer not null default 0,
  cout_centimes numeric(8, 2) not null default 0,
  erreur text,
  annonce boolean not null default false
);

create index mail_runs_user_idx on public.mail_runs (user_id, started_at desc);

alter table public.mail_triage enable row level security;
alter table public.mail_runs enable row level security;

-- Une boîte mail appartient à une personne. Même entre associés, on ne lit pas
-- le courrier de l'autre : la politique le dit plutôt que la convention.
create policy mail_triage_proprietaire on public.mail_triage
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy mail_runs_proprietaire on public.mail_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

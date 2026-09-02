-- Suggestions du jour : une liste d'actions concrètes, régénérée chaque matin.

create table if not exists public.daily_suggestions (
  id          uuid primary key default gen_random_uuid(),
  for_date    date not null default current_date,
  focus       text,
  items       jsonb not null default '[]'::jsonb,
  model       text,
  created_at  timestamptz not null default now(),
  -- Une seule liste par jour : la contrainte rend la génération idempotente,
  -- donc rejouable sans risque de doublon si le cron passe deux fois.
  unique (for_date)
);

alter table public.daily_suggestions enable row level security;

create policy "daily_suggestions_select_staff" on public.daily_suggestions
  for select to authenticated using (public.is_staff());
create policy "daily_suggestions_write_staff" on public.daily_suggestions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Cochage individuel : une suggestion traitée par l'un ne doit pas disparaître
-- de la liste de l'autre, d'où la clé composite incluant l'utilisateur.
create table if not exists public.suggestion_done (
  suggestion_date date not null,
  item_key        text not null,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  done_at         timestamptz not null default now(),
  primary key (suggestion_date, item_key, user_id)
);

alter table public.suggestion_done enable row level security;

create policy "suggestion_done_self" on public.suggestion_done
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

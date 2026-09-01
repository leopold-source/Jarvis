-- =============================================================================
-- Analyse du pipeline par l'IA, et compte commercial de Romain.
-- =============================================================================

create table if not exists public.pipeline_insights (
  id           uuid primary key default gen_random_uuid(),
  headline     text not null,
  horizon_days smallint not null default 21,
  priorities   jsonb not null default '[]'::jsonb,
  reasoning    text,
  -- L'instantané chiffré soumis au modèle : il rend l'analyse relisible plus
  -- tard, quand la donnée aura bougé.
  snapshot     jsonb not null default '{}'::jsonb,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists pipeline_insights_recent_idx on public.pipeline_insights (created_at desc);

alter table public.pipeline_insights enable row level security;

create policy "insights_select_staff" on public.pipeline_insights
  for select to authenticated using (public.is_staff());
create policy "insights_insert_staff" on public.pipeline_insights
  for insert to authenticated with check (public.is_staff());

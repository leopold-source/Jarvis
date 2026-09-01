-- =============================================================================
-- Antichaos CRM — Durcissement : surface RPC minimale, extensions hors public
-- =============================================================================

-- unaccent n'a pas à vivre dans le schéma exposé par PostgREST.
create schema if not exists extensions;
alter extension unaccent set schema extensions;

-- Les fonctions de trigger ne sont jamais appelées directement : Postgres ne
-- vérifie pas EXECUTE pour un trigger, on peut donc tout révoquer.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.handle_new_user()',
    'public.touch_updated_at()',
    'public.deals_track_stage()',
    'public.deals_spawn_project()',
    'public.tasks_track_completion()',
    'public.tasks_default_visibility()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- Les helpers RLS doivent rester exécutables par `authenticated` (les
-- expressions de policy s'évaluent avec les droits de l'appelant) mais pas
-- par un visiteur anonyme.
revoke all on function public.current_role()               from public, anon;
revoke all on function public.is_admin()                   from public, anon;
revoke all on function public.is_staff()                   from public, anon;
revoke all on function public.my_company_id()              from public, anon;
revoke all on function public.client_can_see_project(uuid) from public, anon;
revoke all on function public.convert_lead_to_deal(uuid, text, numeric, uuid) from public, anon;

grant execute on function public.current_role()               to authenticated;
grant execute on function public.is_admin()                   to authenticated;
grant execute on function public.is_staff()                   to authenticated;
grant execute on function public.my_company_id()              to authenticated;
grant execute on function public.client_can_see_project(uuid) to authenticated;
grant execute on function public.convert_lead_to_deal(uuid, text, numeric, uuid) to authenticated;

-- La colonne « fullname » de l'export Leads contient en réalité le libellé de
-- la campagne de prospection ; on lui donne sa propre colonne.
alter table public.leads add column segment text;
create index leads_segment_idx on public.leads (segment);

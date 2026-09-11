-- 1. Le client voit sa facturation.
--
-- Jusqu'ici dossiers et factures étaient réservés à l'équipe. Un client a le
-- droit de savoir ce qui lui a été facturé et ce qu'il reste à payer ; il n'a
-- pas à voir un échéancier prévisionnel établi avant signature, ni le détail
-- des lignes chiffrées. D'où deux restrictions : le devis doit être signé, et
-- seules les factures réellement émises apparaissent.

create or replace function public.client_can_see_dossier(p_dossier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dossiers d
    where d.id = p_dossier_id
      and d.company_id = public.my_company_id()
      and d.quote_signed_at is not null
  );
$$;

create policy dossiers_select_client on public.dossiers
  for select using (
    public.current_role() = 'client'
    and company_id = public.my_company_id()
    and quote_signed_at is not null
  );

create policy invoices_select_client on public.invoices
  for select using (
    public.current_role() = 'client'
    and status in ('emise', 'payee')
    and public.client_can_see_dossier(dossier_id)
  );

-- `dossier_lines` reste sans politique client : le détail de ce qu'on a chiffré
-- n'est pas la même chose que ce qu'on a facturé.


-- 2. Ce que l'IA propose, et ce que ça valait.
--
-- L'application produit des suggestions, des classements, des brouillons.
-- Personne ne mesurait si c'était juste. Sans cette trace, on empile de l'IA au
-- jugé : dans trois mois on ne saurait ni quoi automatiser davantage, ni quoi
-- couper.

create type public.ai_kind as enum (
  'suggestion',
  'insight',
  'mail_tri',
  'mail_brouillon',
  'import_nettoyage'
);

create table public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  kind public.ai_kind not null,
  -- Référence libre : l'identifiant de la ligne jugée, ou la clef d'une
  -- suggestion du jour. Volontairement non contrainte — ce qui est jugé n'a pas
  -- toujours de table, et une contrainte forcerait à inventer des lignes.
  ref text,
  utile boolean not null,
  -- La raison compte plus que le pouce : c'est elle qui dira quoi corriger.
  note text,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (kind, ref, user_id)
);

create index ai_feedback_kind_idx on public.ai_feedback (kind, created_at desc);

alter table public.ai_feedback enable row level security;

create policy ai_feedback_staff on public.ai_feedback
  for all using (public.is_staff()) with check (public.is_staff());

create or replace view public.ai_feedback_bilan with (security_invoker = on) as
select
  kind,
  count(*) as juges,
  count(*) filter (where utile) as utiles,
  round(100.0 * count(*) filter (where utile) / nullif(count(*), 0)) as taux_utile,
  max(created_at) as dernier
from public.ai_feedback
group by kind;

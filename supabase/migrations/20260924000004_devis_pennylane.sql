-- Les devis de Pennylane, vus depuis les affaires.
--
-- Les devis se créent et partent en signature électronique depuis Pennylane.
-- Ce qui manquait, c'est de savoir, depuis le pipeline, où ils en sont : un
-- devis accepté restait « Propale envoyée » tant que personne ne déplaçait la
-- carte, et un devis expiré ne se voyait nulle part.
--
-- Pennylane ne notifie pas les changements de statut des devis : ses webhooks
-- ne couvrent pas ce cas. On relit donc la liste chaque matin et à l'ouverture
-- des affaires, et cette table en garde le miroir.

create table public.devis_pennylane (
  id                 uuid primary key default gen_random_uuid(),
  pennylane_id       text not null unique,
  numero             text,
  statut             text not null default 'inconnu'
                     check (statut in ('brouillon', 'en_attente', 'accepte', 'refuse', 'facture', 'expire', 'inconnu')),
  statut_brut        text,
  montant_ht         numeric(14, 2),
  emis_le            date,
  echeance_le        date,
  client_pennylane_id text,
  client_nom         text,
  url                text,
  -- Rattaché automatiquement par l'entreprise, ou à la main. Un rattachement
  -- manuel n'est jamais défait par la synchronisation.
  deal_id            uuid references public.deals (id) on delete set null,
  lie_a_la_main      boolean not null default false,
  statut_change_le   timestamptz,
  raw                jsonb,
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index devis_pennylane_deal_idx on public.devis_pennylane (deal_id);

alter table public.devis_pennylane enable row level security;
create policy "devis_select_staff" on public.devis_pennylane for select to authenticated using (public.is_staff());
create policy "devis_update_staff" on public.devis_pennylane for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- Le dossier administratif : le réel, là où l'affaire est le théorique.
--
-- Une affaire est une prévision qui meurt à la signature ; un dossier vit des
-- mois après — devis signé, factures émises, encaissements qui traînent. Les
-- confondre dans une seule table condamnerait à ne jamais pouvoir répondre
-- « combien ai-je réellement facturé », et ferait figurer au pipeline des
-- affaires gagnées il y a six mois.

do $$ begin
  create type public.dossier_status as enum
    ('brouillon', 'devis_envoye', 'devis_signe', 'en_facturation', 'solde', 'annule');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_status as enum ('prevue', 'emise', 'payee', 'annulee');
exception when duplicate_object then null; end $$;

create table if not exists public.dossiers (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  -- L'affaire d'origine. Un dossier pourra plus tard en couvrir plusieurs :
  -- c'est la raison d'être de la table, on ne l'enferme pas dans un 1-1.
  deal_id       uuid references public.deals (id) on delete set null,
  company_id    uuid references public.companies (id) on delete set null,
  contact_id    uuid references public.contacts (id) on delete set null,
  project_id    uuid references public.projects (id) on delete set null,

  status        public.dossier_status not null default 'brouillon',

  amount_ht     numeric(12, 2) not null default 0,
  vat_rate      numeric(5, 2) not null default 20,
  amount_ttc    numeric(12, 2) generated always as
                  (round(amount_ht * (1 + vat_rate / 100), 2)) stored,

  payment_terms_days integer not null default 30,

  pennylane_customer_id text,
  pennylane_quote_id    text,
  quote_url             text,
  quote_sent_at         timestamptz,
  quote_signed_at       timestamptz,
  last_sync_error       text,

  notes         text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists dossiers_deal_idx on public.dossiers (deal_id);
create index if not exists dossiers_status_idx on public.dossiers (status, created_at desc);

create table if not exists public.dossier_lines (
  id            uuid primary key default gen_random_uuid(),
  dossier_id    uuid not null references public.dossiers (id) on delete cascade,
  label         text not null,
  quantity      numeric(10, 2) not null default 1,
  unit_price_ht numeric(12, 2) not null default 0,
  vat_rate      numeric(5, 2) not null default 20,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists dossier_lines_dossier_idx on public.dossier_lines (dossier_id, position);

-- Une échéance planifiée devient une facture émise : même ligne, statut qui
-- avance. Les séparer obligerait à recopier, donc à diverger.
create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  dossier_id    uuid not null references public.dossiers (id) on delete cascade,
  label         text not null,
  amount_ht     numeric(12, 2) not null default 0,
  vat_rate      numeric(5, 2) not null default 20,
  amount_ttc    numeric(12, 2) generated always as
                  (round(amount_ht * (1 + vat_rate / 100), 2)) stored,

  status        public.invoice_status not null default 'prevue',
  due_on        date,
  issued_on     date,
  paid_on       date,
  paid_amount   numeric(12, 2) not null default 0,

  pennylane_invoice_id text,
  invoice_number       text,
  invoice_url          text,

  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists invoices_dossier_idx on public.invoices (dossier_id, position);
create index if not exists invoices_encaissement_idx on public.invoices (status, due_on);

create trigger dossiers_touch before update on public.dossiers
  for each row execute function public.touch_updated_at();
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

alter table public.dossiers      enable row level security;
alter table public.dossier_lines enable row level security;
alter table public.invoices      enable row level security;

-- L'administratif reste interne : un client n'y a accès sous aucune forme.
create policy "dossiers_staff" on public.dossiers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "dossier_lines_staff" on public.dossier_lines
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "invoices_staff" on public.invoices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- --- Automatismes -----------------------------------------------------------

-- Le dossier naît avec l'affaire gagnée, sans geste du commercial. Il se
-- déclenche après `deals_spawn_project` — l'ordre alphabétique des triggers le
-- garantit — pour pouvoir rattacher le projet qui vient d'être créé.
create or replace function public.deals_spawn_dossier()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dossier_id uuid;
  v_project_id uuid;
  v_code       text;
  v_amount     numeric(12,2);
begin
  if new.stage <> 'gagne' or old.stage is not distinct from 'gagne' then
    return new;
  end if;

  if exists (select 1 from public.dossiers where deal_id = new.id) then
    return new;
  end if;

  select id into v_project_id from public.projects where deal_id = new.id;

  select 'DOS-' || to_char(now(), 'YYYY') || '-' || lpad((count(*) + 1)::text, 3, '0')
    into v_code
    from public.dossiers
   where created_at >= date_trunc('year', now());

  v_amount := coalesce(new.amount, 0);

  insert into public.dossiers
    (code, deal_id, company_id, contact_id, project_id, amount_ht, created_by)
  values
    (v_code, new.id, new.company_id, new.contact_id, v_project_id, v_amount, new.created_by)
  returning id into v_dossier_id;

  -- Une ligne reprenant l'affaire : un point de départ à corriger, pas une
  -- facturation définitive.
  insert into public.dossier_lines (dossier_id, label, quantity, unit_price_ht, position)
  values (v_dossier_id, new.name, 1, v_amount, 0);

  -- Échéancier 50/50. Les dates restent nulles : elles n'ont de sens qu'à
  -- partir de la signature, et une date inventée fausserait la trésorerie.
  insert into public.invoices (dossier_id, label, amount_ht, position) values
    (v_dossier_id, 'Acompte 50 %', round(v_amount / 2, 2), 0),
    (v_dossier_id, 'Solde 50 %',   v_amount - round(v_amount / 2, 2), 1);

  return new;
end;
$$;

drop trigger if exists deals_spawn_dossier on public.deals;
create trigger deals_spawn_dossier after update on public.deals
  for each row execute function public.deals_spawn_dossier();

revoke execute on function public.deals_spawn_dossier() from public, anon, authenticated;

-- À la signature, les échéances prennent enfin une date : c'est le seul moment
-- où le délai de paiement a un point de départ réel. La n-ième échéance tombe
-- à signature + délai × (n + 1).
create or replace function public.dossiers_date_echeances()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quote_signed_at is not null and old.quote_signed_at is null then
    update public.invoices
       set due_on = new.quote_signed_at::date + new.payment_terms_days * (position + 1)
     where dossier_id = new.id
       and status = 'prevue'
       and due_on is null;

    if new.status = 'devis_envoye' then
      new.status := 'devis_signe';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists dossiers_date_echeances on public.dossiers;
create trigger dossiers_date_echeances before update on public.dossiers
  for each row execute function public.dossiers_date_echeances();

revoke execute on function public.dossiers_date_echeances() from public, anon, authenticated;

-- Vue de trésorerie. Aucun coût n'y figure : tant qu'on ne sait pas d'où ils
-- viendraient, afficher une marge reviendrait à afficher un chiffre faux.
create or replace view public.dossier_finance
with (security_invoker = on) as
select
  d.id as dossier_id,
  d.code,
  d.status,
  d.amount_ht,
  d.amount_ttc,
  coalesce(sum(i.amount_ttc) filter (where i.status in ('emise', 'payee')), 0) as facture_ttc,
  coalesce(sum(i.paid_amount) filter (where i.status = 'payee'), 0)           as encaisse_ttc,
  coalesce(sum(i.amount_ttc) filter (where i.status = 'emise'), 0)            as en_attente_ttc,
  coalesce(sum(i.amount_ttc) filter (where i.status = 'prevue'), 0)           as a_facturer_ttc,
  coalesce(sum(i.amount_ttc) filter (
    where i.status = 'emise' and i.due_on is not null and i.due_on < current_date
  ), 0) as en_retard_ttc,
  min(i.due_on) filter (where i.status in ('prevue', 'emise')) as prochaine_echeance
from public.dossiers d
left join public.invoices i on i.dossier_id = d.id
group by d.id;

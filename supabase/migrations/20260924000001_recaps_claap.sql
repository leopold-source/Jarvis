-- Le contenu des calls, et les récaps qu'on en tire.
--
-- Jusqu'ici un call n'était qu'un titre, une date et un lien vers Claap. Pour
-- relire ce qui s'est dit, il fallait quitter le CRM. Et rien ne pouvait en
-- être tiré automatiquement : pas de transcript, pas de résumé.
--
-- Claap envoie pourtant les deux. Le résumé est dans le corps du webhook — points
-- clés, actions, détail par thème. Le transcript arrive sous la forme d'un lien
-- signé, valable vingt-quatre heures : passé ce délai il ne sert plus à rien, il
-- faut donc le télécharger à la réception et le garder.

alter table public.call_records
  -- Le verbatim, pour que le mail récap parte de ce qui s'est vraiment dit et
  -- non du résumé qu'un autre outil en a fait.
  add column if not exists transcript    text,
  -- L'heure exacte, pas seulement le jour : « le call le plus récent avant le
  -- passage en R2 » se tranche à l'heure près quand deux calls tombent le même
  -- jour.
  add column if not exists started_at    timestamptz,
  add column if not exists ended_at      timestamptz;

comment on column public.call_records.transcript is
  'Transcript texte du call, telecharge a la reception : le lien Claap expire en 24 h.';

alter table public.call_inbox
  add column if not exists summary    text,
  add column if not exists transcript text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at   timestamptz;

-- --- Les récaps d'affaire ----------------------------------------------------
--
-- Un récap naît d'un passage en R2 et vit sa vie : il attend son call, se
-- rédige, attend qu'on le relise, part ou est écarté. Une table plutôt que des
-- colonnes sur l'affaire, parce qu'une affaire peut en connaître plusieurs —
-- une R2 manquée et reprogrammée en déclenche une seconde.

create table public.deal_recaps (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references public.deals (id) on delete cascade,
  -- Celui qui a déplacé la carte : c'est de sa boîte que le mail partira, et
  -- avec sa signature.
  requested_by    uuid references public.profiles (id) on delete set null,
  -- L'instant du passage en R2. Le call retenu est le plus récent avant lui.
  requested_at    timestamptz not null default now(),
  status          text not null default 'en_attente_call'
                  check (status in ('en_attente_call', 'redaction', 'pret', 'envoye', 'ecarte', 'echec')),
  call_record_id  uuid references public.call_records (id) on delete set null,
  to_emails       text[] not null default '{}',
  cc_emails       text[] not null default '{}',
  subject         text,
  body            text,
  -- Ce que le modèle a déduit du transcript, gardé pour qu'on puisse
  -- comprendre un brouillon surprenant.
  tutoiement      boolean,
  model           text,
  error           text,
  sent_at         timestamptz,
  gmail_message_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index deal_recaps_deal_idx on public.deal_recaps (deal_id, requested_at desc);
-- Les récaps qui attendent leur call : c'est ce que parcourt chaque webhook.
create index deal_recaps_attente_idx on public.deal_recaps (deal_id)
  where status = 'en_attente_call';

alter table public.deal_recaps enable row level security;

create policy "deal_recaps_select_staff" on public.deal_recaps
  for select to authenticated using (public.is_staff());
create policy "deal_recaps_insert_staff" on public.deal_recaps
  for insert to authenticated with check (public.is_staff());
create policy "deal_recaps_update_staff" on public.deal_recaps
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "deal_recaps_delete_staff" on public.deal_recaps
  for delete to authenticated using (public.is_staff());

create or replace function public.deal_recaps_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger deal_recaps_touch
  before update on public.deal_recaps
  for each row execute function public.deal_recaps_touch();

-- Savoir qu'un call a son transcript sans le transférer : le transcript d'une
-- heure pèse cent cinquante mille caractères, et la liste des calls d'une
-- affaire n'a besoin que de savoir qu'il existe.
alter table public.call_records
  add column if not exists has_transcript boolean generated always as (transcript is not null) stored;

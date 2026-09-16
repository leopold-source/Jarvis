-- Une affaire, plusieurs interlocuteurs.
--
-- `deals.contact_id` ne tenait qu'un nom, et la réalité en compte souvent
-- trois : le dirigeant qui décide, le responsable technique qui cadre, et
-- l'assistante qui organise. Deux conséquences, l'une visible et l'autre pas.
--
-- La visible : la fiche d'une affaire n'affichait qu'un correspondant, et
-- retrouver les autres demandait de passer par l'entreprise.
--
-- L'invisible, et la plus coûteuse : la synchronisation Gmail rattache un
-- message à une affaire *par son contact*. Un échange avec le responsable
-- technique n'était donc rattaché à rien, et disparaissait — ni dans le fil de
-- l'affaire, ni ailleurs. Le suivi d'une affaire ne montrait que la moitié de
-- ce qui s'était dit.
--
-- La colonne `deals.contact_id` reste, et désigne le contact principal : c'est
-- lui qu'affichent le tableau, le portail et la conversion d'un lead. La table
-- ci-dessous porte la liste complète, lui compris.

create table public.deal_contacts (
  deal_id    uuid not null references public.deals (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  -- Le rôle tenu dans cette affaire-là : « décideur », « technique »,
  -- « achats ». Volontairement libre — une nomenclature imposée se contourne
  -- en quelques semaines, et deux personnes de la même équipe ne tiennent pas
  -- le même rôle d'une affaire à l'autre.
  role       text,
  created_at timestamptz not null default now(),
  primary key (deal_id, contact_id)
);

comment on table public.deal_contacts is
  'Tous les interlocuteurs d''une affaire. deals.contact_id designe le principal, present ici aussi.';

-- L'index dans l'autre sens : la synchronisation Gmail part du contact pour
-- trouver l''affaire, et c''est le chemin le plus emprunte.
create index deal_contacts_contact_idx on public.deal_contacts (contact_id);

alter table public.deal_contacts enable row level security;

create policy "deal_contacts_select_staff" on public.deal_contacts
  for select to authenticated using (public.is_staff());
create policy "deal_contacts_insert_staff" on public.deal_contacts
  for insert to authenticated with check (public.is_staff());
create policy "deal_contacts_update_staff" on public.deal_contacts
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "deal_contacts_delete_staff" on public.deal_contacts
  for delete to authenticated using (public.is_staff());

-- --- Le principal est toujours dans la liste -------------------------------
--
-- Sans cela, la liste et la colonne pourraient se contredire : on retirerait
-- le contact principal de la liste sans que rien ne s'y oppose, et l'affaire
-- afficherait un correspondant que sa propre liste ignore.

create or replace function public.deals_sync_main_contact()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.contact_id is not null then
    insert into public.deal_contacts (deal_id, contact_id)
    values (new.id, new.contact_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger deals_sync_main_contact
  after insert or update of contact_id on public.deals
  for each row execute function public.deals_sync_main_contact();

-- --- Reprise de l'existant -------------------------------------------------

insert into public.deal_contacts (deal_id, contact_id)
select id, contact_id
from public.deals
where contact_id is not null
on conflict do nothing;

-- La dernière action sur un lead, et quand, et par qui.
--
-- La fiche savait quand le statut avait changé et quand on avait « touché »
-- le lead, mais pas ce qu'on avait fait. « Il y a deux jours » ne dit pas si
-- c'était un NRP, une note après un vrai échange ou une relance posée. C'est
-- pourtant ce qu'on veut savoir avant de rappeler.
--
-- Seuls les gestes de prospection comptent : statut, appel sans réponse,
-- note, relance planifiée, mail, conversion. Corriger une coquille dans un
-- SIREN n'en est pas un — la colonne dit où en est la relation, pas qui a
-- édité la fiche en dernier.
--
-- Le type et le détail sont stockés bruts ; le libellé se compose à
-- l'affichage, avec les mêmes intitulés de statut que le reste de
-- l'application, plutôt que d'en recopier une seconde liste ici.

alter table public.leads
  add column if not exists last_action        text
    check (last_action in ('statut', 'nrp', 'note', 'relance', 'mail', 'conversion')),
  add column if not exists last_action_detail text,
  add column if not exists last_action_at     timestamptz,
  add column if not exists last_action_by     uuid references public.profiles (id) on delete set null;

create or replace function public.leads_track_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  derniere_ligne text;
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.last_touched_at   := now();
    new.touch_count       := coalesce(old.touch_count, 0) + 1;

    if new.status <> 'nrp' then
      new.nrp_count := 0;
    elsif old.status <> 'nrp' and new.nrp_count = coalesce(old.nrp_count, 0) then
      new.nrp_count := 1;
    end if;

    insert into public.lead_events (lead_id, kind, from_status, to_status, actor_id)
    values (new.id, 'statut', old.status, new.status, auth.uid());

    -- La conversion est un statut, mais pas un statut comme les autres.
    new.last_action := case
      when new.converted_deal_id is not null and old.converted_deal_id is null then 'conversion'
      else 'statut'
    end;
    new.last_action_detail := case
      when new.status = 'nrp' then 'nrp:' || new.nrp_count
      else new.status::text
    end;
    new.last_action_at := now();
    new.last_action_by := auth.uid();

  elsif new.nrp_count is distinct from coalesce(old.nrp_count, 0) then
    new.status_changed_at := now();
    new.last_touched_at   := now();
    new.touch_count       := coalesce(old.touch_count, 0) + 1;

    insert into public.lead_events (lead_id, kind, from_status, to_status, actor_id)
    values (new.id, 'statut', old.status, new.status, auth.uid());

    new.last_action        := 'nrp';
    new.last_action_detail := new.nrp_count::text;
    new.last_action_at     := now();
    new.last_action_by     := auth.uid();

  elsif new.comment is distinct from old.comment and new.comment is not null then
    -- Un compte rendu d'appel vaut contact, meme sans changement de statut.
    new.last_touched_at := now();

    insert into public.lead_events (lead_id, kind, note, actor_id)
    values (new.id, 'commentaire', left(new.comment, 500), auth.uid());

    -- La note s'ajoute au bas du commentaire : c'est sa derniere ligne qui
    -- dit ce qu'on vient d'ecrire.
    select l into derniere_ligne
    from regexp_split_to_table(new.comment, E'\n') with ordinality as t(l, n)
    where btrim(l) <> ''
    order by n desc
    limit 1;

    new.last_action        := 'note';
    new.last_action_detail := left(btrim(coalesce(derniere_ligne, new.comment)), 160);
    new.last_action_at     := now();
    new.last_action_by     := auth.uid();

  elsif new.follow_up_on is distinct from old.follow_up_on and new.follow_up_on is not null then
    new.last_action        := 'relance';
    new.last_action_detail := new.follow_up_on::text;
    new.last_action_at     := now();
    new.last_action_by     := auth.uid();
  end if;

  return new;
end;
$function$;

-- --- Reprise de l'existant ---------------------------------------------------
-- Le dernier événement connu de chaque lead, pour que la colonne ne soit pas
-- vide le premier jour.
with derniers as (
  select distinct on (lead_id) lead_id, kind, to_status, note, actor_id, created_at
  from public.lead_events
  where kind in ('statut', 'commentaire')
  order by lead_id, created_at desc
)
update public.leads l
set last_action = case when d.kind = 'commentaire' then 'note'
                       when d.to_status::text = 'call_pris' and l.converted_deal_id is not null then 'conversion'
                       else 'statut' end,
    last_action_detail = case when d.kind = 'commentaire' then left(d.note, 160)
                              when d.to_status::text = 'nrp' then 'nrp:' || greatest(l.nrp_count, 1)
                              else d.to_status::text end,
    last_action_at = d.created_at,
    last_action_by = d.actor_id
from derniers d
where d.lead_id = l.id and l.last_action_at is null;

create index if not exists leads_last_action_at_idx on public.leads (last_action_at desc nulls last);

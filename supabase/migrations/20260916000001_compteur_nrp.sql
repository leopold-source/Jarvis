-- NRP devient un compteur plutôt que trois statuts.
--
-- « NRP », « NRP 2 » et « NRP 3 » disaient une seule chose — le nombre de fois
-- qu'on a appelé sans réponse — en la répartissant sur trois valeurs d'énumération.
-- Le coût se voyait à l'usage : pour passer de deux à trois tentatives il fallait
-- rouvrir une liste déroulante et y choisir la bonne ligne, et au-delà de trois
-- il n'y avait plus rien à choisir.
--
-- Un statut, un compteur. Les valeurs `nrp2` et `nrp3` restent dans le type —
-- Postgres ne sait pas retirer une valeur d'une énumération sans la recréer, et
-- plus aucune ligne ne les porte — mais l'application ne les propose plus.
alter table public.leads
  add column nrp_count smallint not null default 0
    constraint leads_nrp_count_borne check (nrp_count between 0 and 9);

update public.leads
set nrp_count = case status when 'nrp' then 1 when 'nrp2' then 2 when 'nrp3' then 3 else 0 end
where status in ('nrp', 'nrp2', 'nrp3');

update public.leads set status = 'nrp' where status in ('nrp2', 'nrp3');

/*
  Le déclencheur apprend à compter.

  Il ne réagissait qu'au changement de statut. Or incrémenter le compteur *est*
  un événement commercial : c'est un appel de plus, passé aujourd'hui. Sans
  cette branche, la quatrième tentative laissait la fiche avec la date de la
  troisième, et la file d'appel la croyait fraîche.

  Le compteur se remet par ailleurs d'aplomb tout seul : il retombe à zéro dès
  qu'on quitte NRP, et démarre à un quand on y entre. Sans quoi un lead repassé
  en NRP six mois plus tard reprendrait au compte de l'époque.
*/
create or replace function public.leads_track_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  elsif new.nrp_count is distinct from coalesce(old.nrp_count, 0) then
    new.status_changed_at := now();
    new.last_touched_at   := now();
    new.touch_count       := coalesce(old.touch_count, 0) + 1;

    insert into public.lead_events (lead_id, kind, from_status, to_status, actor_id)
    values (new.id, 'statut', old.status, new.status, auth.uid());

  elsif new.comment is distinct from old.comment and new.comment is not null then
    -- Un compte rendu d'appel vaut contact, meme sans changement de statut.
    new.last_touched_at := now();

    insert into public.lead_events (lead_id, kind, note, actor_id)
    values (new.id, 'commentaire', left(new.comment, 500), auth.uid());
  end if;

  return new;
end;
$function$;

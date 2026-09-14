-- Historique des passages du tri, et sa péremption.
--
-- Jusqu'ici, l'écran des mails ne montrait que le dernier passage, et il le
-- reconstituait en comparant des horodatages : « tout ce qui a été créé après
-- le début du run, à une minute près ». Ça marche tant qu'il n'y a qu'un
-- passage à regarder. Dès qu'on veut relire celui d'avant-hier, la déduction
-- devient fausse — deux passages rapprochés se mélangent, et une reprise qui
-- efface puis réinsère des lignes brouille définitivement les bornes.
--
-- Un mail appartient à un passage : autant l'écrire.

alter table public.mail_triage
  add column run_id uuid references public.mail_runs (id) on delete set null;

-- L'index porte sur le couple, pas sur la seule colonne : on lit toujours
-- « les mails de ce passage », jamais « tous les mails de ce run toutes
-- boîtes confondues ».
create index mail_triage_run_idx on public.mail_triage (user_id, run_id);

/*
  Rattachement de l'existant.

  Chaque ligne rejoint le passage le plus récent qui a commencé avant elle.
  C'est exactement la règle que l'écran appliquait jusqu'ici, appliquée une
  dernière fois — mais figée dans une colonne plutôt que recalculée à chaque
  affichage. Les lignes antérieures au premier passage restent sans rattachement
  et l'interface les groupe à part.
*/
update public.mail_triage as t
set run_id = (
  select r.id
  from public.mail_runs as r
  where r.user_id = t.user_id
    and r.started_at <= t.created_at + interval '1 minute'
  order by r.started_at desc
  limit 1
)
where t.run_id is null;

/*
  La péremption à quinze jours.

  Un tri quotidien qui garde tout finit par accumuler des milliers de lignes
  dont personne ne fera jamais rien : passé deux semaines, on ne revient pas
  sur un classement de mail. La coupe est donc franche, et elle porte sur les
  deux tables.

  `security definer` parce que la fonction est appelée par le cron, qui n'a pas
  de session : les politiques de sécurité au niveau ligne la bloqueraient. Le
  `search_path` figé est la contrepartie obligatoire — sans lui, un schéma
  glissé devant `public` détournerait la fonction vers ses propres tables.
*/
create or replace function public.purger_historique_mails(jours integer default 15)
returns table (passages_supprimes integer, mails_supprimes integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  limite timestamptz := now() - make_interval(days => greatest(jours, 1));
  mails integer;
  passages integer;
begin
  -- Les mails d'abord : la contrainte met leur `run_id` à null si le passage
  -- part en premier, et on perdrait le moyen de les retrouver.
  delete from public.mail_triage where created_at < limite;
  get diagnostics mails = row_count;

  delete from public.mail_runs where started_at < limite;
  get diagnostics passages = row_count;

  return query select passages, mails;
end;
$$;

comment on function public.purger_historique_mails is
  'Efface les passages de tri et les mails triés plus vieux que N jours (15 par défaut).';

revoke all on function public.purger_historique_mails(integer) from public, anon, authenticated;

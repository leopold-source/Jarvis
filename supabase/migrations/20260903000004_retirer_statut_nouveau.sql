-- « Nouveau » disparaît : un lead qui entre est un lead à appeler.
--
-- Le statut ne disait rien de plus que la date de création, et il coupait la
-- base en deux : les 239 fiches d'un import restaient invisibles du mode
-- prospection alors que c'est précisément là qu'elles doivent être.

-- Le renommage n'est pas une activité commerciale. Sans cette mise en sommeil,
-- le déclencheur daterait les fiches d'aujourd'hui et les ferait toutes passer
-- pour appelées ce matin — jusqu'à déclencher les alertes de doublon d'appel.
alter table public.leads disable trigger leads_track_activity;
alter table public.leads disable trigger leads_touch;

update public.leads set status = 'a_contacter' where status = 'nouveau';
update public.lead_events set from_status = 'a_contacter' where from_status = 'nouveau';
update public.lead_events set to_status = 'a_contacter' where to_status = 'nouveau';

alter table public.leads enable trigger leads_track_activity;
alter table public.leads enable trigger leads_touch;

-- PostgreSQL ne sait pas retirer une valeur d'un enum : il faut le refaire.
alter type public.lead_status rename to lead_status_ancien;

create type public.lead_status as enum (
  'a_contacter',
  'nrp',
  'nrp2',
  'nrp3',
  'a_recontacter',
  'raccroche_avant_pitch',
  'pas_interesse',
  'non_qualifie',
  'call_pris'
);

alter table public.leads alter column status drop default;
alter table public.leads
  alter column status type public.lead_status using status::text::public.lead_status;
alter table public.leads alter column status set default 'a_contacter';

alter table public.lead_events
  alter column from_status type public.lead_status using from_status::text::public.lead_status,
  alter column to_status type public.lead_status using to_status::text::public.lead_status;

drop type public.lead_status_ancien;

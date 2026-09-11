-- `org_key_from` n'avait pas de search_path figé.
--
-- La fonction ne lit aucune table et n'appelle que des primitives de
-- pg_catalog, donc le risque est faible ; mais elle alimente une colonne
-- générée sur `leads`, c'est-à-dire qu'elle s'exécute à chaque insertion pour
-- tout le monde. Une fonction dans ce cas ne doit pas dépendre du chemin de
-- recherche de son appelant.
alter function public.org_key_from(text, text, text) set search_path = '';

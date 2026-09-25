-- Les tâches en tableau, comme le Sheet qu'elles remplacent.
--
-- La priorité devient un rang (1, 2, 3) plutôt qu'une étoile, et chaque
-- associé a sa colonne de commentaire (« Com Léopold », « Com Romain ») au lieu
-- d'un fil de discussion : c'est la structure dont l'équipe a l'habitude.

alter table public.todos drop column prio;
alter table public.todos add column priorite smallint check (priorite between 1 and 3);
alter table public.todos add column commentaires jsonb not null default '{}'::jsonb;

drop table public.todo_comments;

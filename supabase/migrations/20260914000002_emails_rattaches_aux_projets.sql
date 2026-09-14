-- Rattachement des échanges aux projets.
--
-- Un message ne cesse pas d'intéresser le jour où l'affaire est gagnée : c'est
-- même à partir de là qu'il compte le plus, puisqu'il devient la trace de ce
-- qu'on a promis au client. La colonne existait déjà et personne ne l'écrivait ;
-- la synchronisation le fait désormais, et l'existant se rattache ici, une
-- fois, par l'affaire dont le projet est issu.
update public.email_messages as m
set project_id = p.id
from public.projects as p
where m.project_id is null
  and m.deal_id is not null
  and p.deal_id = m.deal_id;

-- L'écran du projet lit « les messages de ce projet, du plus récent au plus
-- ancien » : l'index porte sur le couple, pas sur la seule colonne.
create index if not exists email_messages_project_idx
  on public.email_messages (project_id, sent_at desc);

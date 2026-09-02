-- Synchronisation Gmail : jetons, traçabilité, et cloisonnement du secret.

alter table public.google_accounts
  add column if not exists last_error      text,
  add column if not exists synced_count    integer not null default 0,
  add column if not exists connected_at    timestamptz not null default now();

-- Le jeton de rafraîchissement vaut un mot de passe : il ouvre la boîte mail de
-- l'utilisateur tant qu'il n'est pas révoqué. La politique RLS laisse chacun
-- lire sa propre ligne — pratique pour afficher l'état de la connexion — mais
-- cette colonne-là doit rester hors de portée du navigateur.
--
-- Un privilège accordé au niveau de la table couvre toutes ses colonnes et
-- l'emporte sur un `revoke` ciblé : retirer la colonne seule ne produit donc
-- rien. Il faut couper l'accès global, puis le rendre colonne par colonne.
-- Toutes les écritures passent par la clé service_role, qui ignore ces règles.
revoke select, insert, update, delete on public.google_accounts from authenticated;
revoke select, insert, update, delete on public.google_accounts from anon;

grant select (user_id, email, scope, last_synced_at, last_error, synced_count, connected_at, created_at)
  on public.google_accounts to authenticated;

-- Les e-mails rattachés à une affaire sont lisibles par l'équipe (politique
-- posée à la migration RLS) ; on ajoute seulement les index qui manquaient pour
-- les recherches par contact et par fil de discussion.
create index if not exists email_messages_contact_idx
  on public.email_messages (contact_id, sent_at desc);
create index if not exists email_messages_thread_idx
  on public.email_messages (thread_id);

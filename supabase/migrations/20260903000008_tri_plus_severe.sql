-- Le tri devient sévère, et se justifie.
--
-- Deux constats d'usage. D'abord « rangé » ne voulait rien dire : le message
-- recevait une étiquette et restait sous les yeux, ce qui ne vide aucune boîte.
-- Ensuite trop de choses étaient gardées — démarchage en anglais, fin d'essai
-- d'un outil, alerte automatique — alors qu'aucune n'appelle de décision.
--
-- La catégorie `notification` sépare le transactionnel du reste, et le drapeau
-- `a_signaler` sépare deux questions qu'on confondait : que fait-on du message,
-- et faut-il en parler. Une alerte de sécurité part à la corbeille ET remonte.

alter type public.mail_category add value if not exists 'notification';

alter table public.mail_triage
  add column a_signaler boolean not null default false;

comment on column public.mail_triage.a_signaler is
  'Vrai pour un message écarté qui doit tout de même être porté à la connaissance : alerte de sécurité, échec de paiement, changement de mot de passe.';

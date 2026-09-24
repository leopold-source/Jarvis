-- Le même mail, vu depuis deux boîtes.
--
-- Gmail donne à chaque boîte son propre identifiant de message. Dès que la
-- synchro couvre toute l'équipe, un mail envoyé au client avec l'associé en
-- copie existe deux fois. L'en-tête Message-ID, posé par l'expéditeur, est le
-- seul identifiant commun aux deux copies.
alter table public.email_messages add column if not exists rfc_message_id text;
create index if not exists email_messages_rfc_idx
  on public.email_messages (rfc_message_id) where rfc_message_id is not null;

-- Les notifications d'agenda déjà rangées dans les fils d'affaires :
-- invitations, acceptations, refus, nouvel horaire proposé. Elles sont
-- désormais écartées à la synchronisation.
delete from public.email_messages
where subject ~* '^(invitation( mise à jour| modifiée| annulée)?|updated invitation|accepté(e)?|accepted|refusé(e)?|declined|nouvel horaire proposé|new time proposed|événement annulé|cancel(l)?ed event)\s*[:：]'
   or lower(from_email) = 'calendar-notification@google.com';

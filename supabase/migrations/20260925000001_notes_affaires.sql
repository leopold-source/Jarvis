-- Notes de rendez-vous et synthèse IA d'une affaire.
--
-- Les notes R1 et R2 sont du HTML produit par l'éditeur de l'application, qui
-- ne sait écrire que ce que son schéma connaît (titres, listes, cases,
-- surlignage, liens). La synthèse est un JSON structuré, régénérée à la
-- demande seulement : elle dit sur quoi elle s'appuie et quand.

alter table public.deals
  add column if not exists note_r1 text,
  add column if not exists note_r2 text,
  add column if not exists notes_updated_at timestamptz,
  add column if not exists synthese_ia jsonb,
  add column if not exists synthese_ia_at timestamptz,
  add column if not exists synthese_ia_model text;

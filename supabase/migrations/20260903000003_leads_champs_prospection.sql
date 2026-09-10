-- Ce que les exports de prospection apportent et que la table perdait.
--
-- Un export de sourcing porte le poste occupé, le SIREN, l'effectif, la ligne
-- standard, la raison sociale. Rien de tout cela n'avait de colonne : les
-- données étaient lues puis jetées, sans message. Chacune est ici parce qu'une
-- décision s'y appuie — le poste dit si l'on parle au bon interlocuteur,
-- l'effectif porte la segmentation, le SIREN et la raison sociale alimenteront
-- la facturation le jour où l'affaire se gagne, et le standard rattrape les
-- fiches sans portable : dans un export typique il y en a deux fois plus.

alter table public.leads
  add column job_title text,
  add column phone_standard text,
  add column company_legal_name text,
  add column company_linkedin_url text,
  add column company_description text,
  add column siren text,
  add column siret text,
  add column headcount integer,
  add column headcount_range text,
  add column founded_year integer,
  add column revenue_year integer,
  add column email_quality text;

comment on column public.leads.phone_standard is
  'Ligne standard de l''entreprise. Distincte du portable : on ne les compose pas dans le meme ordre.';
comment on column public.leads.company_legal_name is
  'Raison sociale. Le nom commercial vit dans company_name ; c''est celle-ci qui devra figurer sur un devis.';
comment on column public.leads.email_quality is
  'Fiabilite annoncee par la source. Un e-mail douteux se brule une seule fois.';

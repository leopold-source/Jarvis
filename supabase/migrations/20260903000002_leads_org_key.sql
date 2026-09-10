-- Rattacher les leads qui désignent la même organisation.
--
-- Constat sur la base réelle : le nom d'entreprise ne rapproche presque rien.
-- « Auddice Seine Normandie » et « Auddice Environnement » sont deux raisons
-- sociales pour un même groupe, « Verdi Normandie » et « Verdi Nord de France »
-- aussi, et « Diagobat » a pour domaine réel groupe-projex.fr. Grouper par nom
-- aurait raté les trois. Le domaine e-mail, lui, les attrape.
--
-- Ce qui suit ne fusionne rien : appeler deux dirigeants d'un même groupe est
-- souvent légitime. Le but est seulement qu'on ne puisse plus le faire sans
-- s'en rendre compte.

create or replace function public.org_key_from(
  p_email text,
  p_website text,
  p_company text
) returns text
language sql
immutable
as $$
  select coalesce(
    -- 1. Domaine e-mail professionnel : le signal le plus sûr. Les messageries
    --    grand public sont écartées — elles ne disent rien de l'employeur.
    nullif(
      case
        when position('@' in coalesce(p_email, '')) > 0
         and split_part(lower(trim(p_email)), '@', 2) not in (
              'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr',
              'hotmail.com', 'hotmail.fr', 'yahoo.com', 'yahoo.fr',
              'free.fr', 'orange.fr', 'wanadoo.fr', 'sfr.fr', 'neuf.fr',
              'laposte.net', 'live.fr', 'icloud.com', 'me.com', 'aol.com',
              'bbox.fr', 'numericable.fr', 'gmx.fr', 'protonmail.com', 'proton.me'
            )
        then split_part(lower(trim(p_email)), '@', 2)
      end, ''),
    -- 2. Domaine du site, ramené à son hôte.
    nullif(
      regexp_replace(lower(trim(coalesce(p_website, ''))),
                     '^(https?://)?(www\.)?([^/?#]+).*$', '\3'),
      ''),
    -- 3. Nom d'entreprise réduit à ses caractères significatifs. Ne rapproche
    --    que les saisies quasi identiques : c'est voulu, mieux vaut rater un
    --    lien que d'en inventer un.
    nullif(regexp_replace(lower(trim(coalesce(p_company, ''))), '[^a-z0-9]', '', 'g'), '')
  );
$$;

alter table public.leads
  add column org_key text
    generated always as (public.org_key_from(email, company_website, company_name)) stored;

-- Les neuf derniers chiffres : « +33 6 08 37 03 60 » et « 06 08 37 03 60 »
-- désignent la même ligne. Second lien, là où l'entreprise diffère mais la
-- personne non — un dirigeant présent dans deux sociétés. L'application ignore
-- un numéro partagé par trop de fiches : c'est alors un standard, pas un lien.
alter table public.leads
  add column phone_key text
    generated always as (
      nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9), '')
    ) stored;

create index leads_org_key_idx on public.leads (org_key) where org_key is not null;
create index leads_phone_key_idx on public.leads (phone_key) where phone_key is not null;

-- Réglages applicatifs : ce qui relève d'un arbitrage et non d'une règle
-- technique, et doit donc changer sans redéploiement.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('prospection', '{"org_cooldown_days": 30}'::jsonb);

alter table public.app_settings enable row level security;

create policy app_settings_select_staff on public.app_settings
  for select using (public.is_staff());

create policy app_settings_write_admin on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

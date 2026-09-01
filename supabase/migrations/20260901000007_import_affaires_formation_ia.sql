-- =============================================================================
-- Import des affaires « Formation IA », depuis l'export CSV du pipeline.
-- Périmètre : à partir de JC-Ingénierie, uniquement l'offre « Formation IA ».
--
-- Pour chaque ligne : l'entreprise et le contact sont créés s'ils n'existent
-- pas, puis l'affaire est ouverte à son étape réelle. Le script est rejouable :
-- une affaire déjà importée n'est pas dupliquée.
-- =============================================================================

do $$
declare
  v_owner uuid;
  r record;
  v_company_id uuid;
  v_contact_id uuid;
  v_deal_id uuid;
  v_position double precision := 1000;
begin
  select id into v_owner from public.profiles where role = 'admin' order by created_at limit 1;

  for r in
    select * from (values
      ('JC-Ingénierie',           'Jean-Charles', 'Desfrennes',    'JC-Ingénierie',           '',                                    '',                    '',                                       'no_show',             '', null::date, null::numeric, '2026-02-05'::date),
      ('Acogec',                  'Eric',         'Mayost',        'Acogec',                  '',                                    '',                    '',                                       'perdu',               E'Call R1 : arrivé 20 mn en retard mais m\'a accordé les 25 mn.\nPas convaincu par l\'intérêt de l\'IA, n\'a pas compris ce que je faisais.\nTrès direct : « je ne veux pas perdre de temps en demandant à tous mes gars ce qu\'ils pourraient faire avec l\'IA et que ça parte dans tous les sens ». Il veut un outil qu\'on implémente, et on dit aux équipes de travailler de telle manière.\nPeur de l\'inconnu : « je ne vais pas m\'aventurer sur un projet qui va plus me faire perdre de temps qu\'en gagner ».\n\nObjections : « un ingénieur je le paye pour réfléchir, pas besoin d\'IA » · l\'IA est interdite dans l\'entreprise · veut un outil précis qui fait gagner du temps, pas du généraliste · ne connaît pas et ne maîtrise pas l\'IA · ne veut pas complexifier.', '2026-08-10'::date, null::numeric, '2026-02-05'::date),
      ('Helfy',                   'Yoann',        'Francois',      'Helfy',                   'https://helfy.fr',                    '+33 6 86 93 78 54',   'yoann.francois@helfy.fr',                'no_show',             '', null::date, null::numeric, '2026-03-03'::date),
      ('Rni',                     'Clement',      'Dooze',         'Rni',                     'https://rni-france.fr',               '+33 7 84 25 23 60',   'cdooze@rni-france.fr',                   'nurturing',           E'A déjà essayé des IA gratuites, se rend compte de la quantité d\'argent perdue chaque semaine : environ 10 k€/mois, 120 k€ sur un an.\n\nA donné un ok de principe, mais vend une société en parallèle — la logistique était compliquée.', '2026-04-09'::date, null::numeric, '2026-03-05'::date),
      ('Sodacen',                 'Max',          'Vanhove',       'Sodacen',                 'https://sodacen.sitseo.com',          '+33 6 78 32 10 42',   'maxvanhove@sodacen.fr',                  'no_show',             '', null::date, null::numeric, '2026-03-05'::date),
      ('Je2d',                    'Etienne',      'Demeiller',     'Je2d',                    'https://enerbioflex.fr',              '+33 6 80 45 39 59',   'etienne.demeiller@enerbioflex.fr',       'nurturing',           '', null::date, null::numeric, '2026-03-10'::date),
      ('Ecotechnics',             'Sebastien',    'Sergent',       'Ecotechnics',             'https://www.ecotechnics.fr',          '+33 6 80 45 49 98',   'ssergent@ecotechnics.fr',                'non_qualifie',        '', null::date, null::numeric, '2026-03-11'::date),
      ('EODA Realisations',       'Jan-Bart',     'Taminiau',      'EODA Realisations',       'https://eoda-realisations.fr',        '+33 6 08 63 99 43',   'jbtaminiau@eoda.fr',                     'propale_envoyee',     '', null::date, null::numeric, '2026-03-13'::date),
      ('SF Precision',            'Stephane',     'Crepy',         'SF Precision',            'https://www.sf-precision.fr',         '+33 6 46 41 36 70',   's.crepy@sf-precision.fr',                'non_qualifie',        E'Envoyer un rappel par mail.\nDoit voir avec son associé.', null::date, null::numeric, '2026-03-17'::date),
      ('Valutec',                 'Bertrand',     'Canaple',       'Valutec',                 'https://www.valutec.fr',              '+33 6 03 74 44 38',   'bertrand.canaple@valutec.fr',            'no_show',             E'Envoyer un rappel. Moyennement chaud, n\'avait pas trop le temps : la qualification par téléphone n\'a pas été très bien faite.\nIl a déjà des RAG ; le besoin porte plutôt sur l\'intégration et la formation.', null::date, null::numeric, '2026-03-17'::date),
      ('BM2S',                    'Nicolas',      'Queouron',      'BM2S',                    '',                                    '+33 7 88 13 05 50',   'nicolas.queouron@bm2s-bretagne.fr',      'gagne',               E'À l\'aise et ouverts à l\'IA, curieux de voir. Ils ont déjà Gemini.', null::date, null::numeric, '2026-03-24'::date),
      ('Carbonapp',               'Paul',         'Bonan',         'Carbonapp',               'https://www.carbonapp.fr',            '+33 6 52 89 42 50',   'p.bonan@carbonapp.fr',                   'nurturing',           E'Déjà des agents IA en phase de test, des RAG en place. Application très métier.\nAftech vient former leurs équipes tous les six mois pour mettre à jour leur savoir.', null::date, null::numeric, '2026-03-25'::date),
      ('Gti France',             'Pierre',       'Hayart',        'Gti France',              'https://www.gtifrance.fr',            '+33 6 80 66 39 36',   'hayart.pierre@gtifrance.fr',             'nurturing',           '', '2026-10-05'::date, null::numeric, '2026-04-01'::date),
      ('Archimed Environnement',  'Amandine',     'Kubler',        'Archimed Environnement',  'https://www.archimed-env.com',        '+33 7 79 52 52 70',   'akubler@archimed-env.com',               'propale_envoyee',     '', null::date, null::numeric, '2026-04-14'::date),
      ('JCL Ingenierie',          'Paul',         'Bernier',       'JCL Ingenierie',          'https://jcl-ingenierie.com',          '+33 6 37 07 91 05',   'p.bernier@jcl-ingenierie.com',           'no_show',             '', null::date, null::numeric, '2026-04-22'::date),
      ('Pint',                    'Paul',         'Didier',        'Pint',                    'https://pint.fr',                     '+33 6 71 03 34 37',   'paul.didier@pint.fr',                    'no_show',             '', null::date, null::numeric, '2026-04-23'::date),
      ('Meha',                    'Sebastien',    'Meha',          'Meha',                    'https://meha.fr',                     '+33 6 72 92 46 09',   'sebastien@meha.fr',                      'no_show',             '', null::date, null::numeric, '2026-04-30'::date),
      ('Catesis',                 'Nicolas',      'Pavot',         'Catesis',                 '',                                    '+33 6 61 71 64 20',   'nicolas.pavot@catesis.fr',               'no_show',             '', null::date, null::numeric, '2026-05-06'::date),
      ('Sega',                    'Francois',     'Duverger',      'Sega',                    'https://www.segaelec.fr',             '+33 6 10 25 09 74',   'f.duverger@segaelec.fr',                 'propale_envoyee',     '', null::date, null::numeric, '2026-05-06'::date),
      ('Otci',                    'Emmanuel',     'Lapeyre',       'Otci',                    'http://www.otci.fr',                  '+33 6 24 75 88 28',   'lapeyre@otci.fr',                        'nurturing',           '', null::date, null::numeric, '2026-05-12'::date),
      ('Cometa',                  'Sinan',        'Saadoun',       'Cometa',                  'https://cometa.fr',                   '+33 6 06 49 49 99',   's.saadoun@cometa.fr',                    'no_show',             '', null::date, null::numeric, '2026-05-22'::date),
      ('Progerep',                'Didier',       'Martin',        'Progerep',                'https://progerep.fr',                 '+33 6 84 61 17 60',   'dmartin.progerep@yahoo.fr',              'propale_envoyee',     '', null::date, null::numeric, '2026-06-01'::date),
      ('Crea Concept',            'Stephan',      'Machefert',     'Crea Concept',            'https://creaconcept.fr',              '+33 6 24 84 07 13',   's.machefert@creaconcept.fr',             'r2',                  '', null::date, null::numeric, '2026-06-11'::date),
      ('Atdx',                    'Rodolphe',     'Salles',        'Atdx',                    'http://www.atdx.fr',                  '+33 6 73 17 29 75',   'rodolphe.salles@atdx.fr',                'demande_rdv_envoyee', '', null::date, null::numeric, '2026-06-12'::date),
      ('Siteléco',                'Guillaume',    'Wrona',         'Siteléco',                'https://siteleco.fr',                 '+33 6 75 32 15 36',   'guillaume.wrona@siteleco.fr',            'no_show',             '', null::date, null::numeric, '2026-06-12'::date),
      ('Segeta',                  'Gregory',      'Leost',         'Segeta',                  'https://www.segeta.fr',               '+33 6 07 10 36 49',   'g.leost@segeta.fr',                      'no_show',             '', null::date, null::numeric, '2026-06-16'::date),
      ('Keeplanet',               'Julien',       'Pierre',        'Keeplanet',               'https://keeplanet.fr',                '+33 6 33 37 25 80',   'julien.pierre@keeplanet.fr',             'demande_rdv_envoyee', '', '2026-07-20'::date, 5000::numeric, '2026-06-18'::date),
      ('Hardy Environnement',     'Bruno',        'Vasseur',       'Hardy Environnement',     'https://www.hardy-environnement.fr',  '+33 7 69 50 36 17',   'bruno.vasseur@hardy-environnement.fr',   'no_show',             '', null::date, null::numeric, '2026-07-08'::date)
    ) as t(company_label, first_name, last_name, company_name, website, phone, email, stage, comment, relance, amount, created)
  loop
    -- Affaire déjà importée : on passe.
    if exists (select 1 from public.deals where name = 'Formation IA - ' || r.company_label) then
      continue;
    end if;

    -- Entreprise, réutilisée si le nom existe déjà.
    select id into v_company_id
    from public.companies where lower(name) = lower(r.company_name) limit 1;

    if v_company_id is null then
      insert into public.companies (name, website, activity, owner_id, created_by)
      values (r.company_name, nullif(r.website, ''), 'Formation IA', v_owner, v_owner)
      returning id into v_company_id;
    end if;

    -- Contact, dédoublonné sur l'e-mail quand il est présent.
    v_contact_id := null;
    if nullif(r.email, '') is not null then
      select id into v_contact_id from public.contacts where lower(email) = lower(r.email) limit 1;
    end if;

    if v_contact_id is null then
      insert into public.contacts
        (company_id, first_name, last_name, email, phone, is_primary, owner_id, created_by)
      values
        (v_company_id, r.first_name, r.last_name, nullif(r.email, ''), nullif(r.phone, ''),
         true, v_owner, v_owner)
      returning id into v_contact_id;
    end if;

    v_position := v_position + 100;

    insert into public.deals
      (name, company_id, contact_id, stage, amount, owner_id, created_by,
       description, next_step_on, position, created_at, stage_changed_at)
    values
      ('Formation IA - ' || r.company_label,
       v_company_id, v_contact_id,
       -- Une affaire gagnée entre d'abord en « propale envoyée » : le passage en
       -- « gagné » se fait juste après, par un UPDATE, pour que le trigger
       -- `deals_spawn_project` crée bien le projet associé.
       case when r.stage = 'gagne' then 'propale_envoyee' else r.stage end::public.deal_stage,
       r.amount, v_owner, v_owner,
       nullif(r.comment, ''), r.relance, v_position,
       r.created::timestamptz, r.created::timestamptz)
    returning id into v_deal_id;

    if r.stage = 'gagne' then
      update public.deals set stage = 'gagne' where id = v_deal_id;
    end if;
  end loop;
end $$;

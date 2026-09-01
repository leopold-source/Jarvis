-- =============================================================================
-- Antichaos CRM — Row Level Security
--   admin  : accès total, y compris suppressions et gestion des utilisateurs
--   member : accès complet au CRM interne et aux projets (pas de suppression)
--   client : lecture seule sur les projets de SON entreprise, uniquement sur
--            ce qui a été explicitement partagé (is_client_visible)
-- =============================================================================

create or replace function public.client_can_see_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.company_id is not null
      and p.company_id = public.my_company_id()
  );
$$;

alter table public.companies       enable row level security;
alter table public.contacts        enable row level security;
alter table public.leads           enable row level security;
alter table public.deals           enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks           enable row level security;
alter table public.documents       enable row level security;
alter table public.comments        enable row level security;
alter table public.activities      enable row level security;
alter table public.email_messages  enable row level security;
alter table public.google_accounts enable row level security;

-- --- Tables 100 % internes ---------------------------------------------
-- Lecture / écriture pour le staff, suppression réservée aux admins.
do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'leads', 'deals', 'email_messages'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())',
                   t || '_select_staff', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())',
                   t || '_insert_staff', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())',
                   t || '_update_staff', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())',
                   t || '_delete_admin', t);
  end loop;
end $$;

-- Le client peut relire la fiche de sa propre entreprise.
create policy "companies_select_own_client" on public.companies
  for select to authenticated
  using (public.current_role() = 'client' and id = public.my_company_id());

create policy "contacts_select_own_client" on public.contacts
  for select to authenticated
  using (public.current_role() = 'client' and company_id = public.my_company_id());

-- --- Projets ------------------------------------------------------------
create policy "projects_select_staff" on public.projects
  for select to authenticated using (public.is_staff());
create policy "projects_insert_staff" on public.projects
  for insert to authenticated with check (public.is_staff());
create policy "projects_update_staff" on public.projects
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "projects_delete_admin" on public.projects
  for delete to authenticated using (public.is_admin());

create policy "projects_select_client" on public.projects
  for select to authenticated
  using (public.current_role() = 'client' and company_id = public.my_company_id());

create policy "project_members_staff_all" on public.project_members
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- --- Tâches / jalons ----------------------------------------------------
create policy "tasks_staff_all" on public.tasks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "tasks_select_client" on public.tasks
  for select to authenticated
  using (
    public.current_role() = 'client'
    and is_client_visible
    and public.client_can_see_project(project_id)
  );

-- --- Documents ----------------------------------------------------------
create policy "documents_staff_all" on public.documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "documents_select_client" on public.documents
  for select to authenticated
  using (
    public.current_role() = 'client'
    and is_client_visible
    and project_id is not null
    and public.client_can_see_project(project_id)
  );

-- --- Commentaires -------------------------------------------------------
create policy "comments_staff_all" on public.comments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "comments_select_client" on public.comments
  for select to authenticated
  using (
    public.current_role() = 'client'
    and is_client_visible
    and project_id is not null
    and public.client_can_see_project(project_id)
  );

-- Le client peut écrire sur ses projets ; son message est visible des deux côtés.
create policy "comments_insert_client" on public.comments
  for insert to authenticated
  with check (
    public.current_role() = 'client'
    and author_id = auth.uid()
    and is_client_visible
    and project_id is not null
    and public.client_can_see_project(project_id)
  );

create policy "comments_update_own" on public.comments
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- --- Journal ------------------------------------------------------------
create policy "activities_select_staff" on public.activities
  for select to authenticated using (public.is_staff());
create policy "activities_insert_auth" on public.activities
  for insert to authenticated with check (auth.uid() is not null);

-- --- Jetons Google (jamais lisibles côté navigateur) --------------------
create policy "google_accounts_self" on public.google_accounts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

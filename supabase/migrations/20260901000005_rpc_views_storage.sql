-- =============================================================================
-- Antichaos CRM — Conversion de lead, vues d'agrégat, stockage des documents
-- =============================================================================

-- --- Conversion « call pris » -> entreprise + contact + affaire -----------
-- Idempotent : si le lead a déjà été converti, on renvoie les ids existants.
create or replace function public.convert_lead_to_deal(
  p_lead_id     uuid,
  p_deal_name   text default null,
  p_amount      numeric default null,
  p_owner_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead       public.leads%rowtype;
  v_company_id uuid;
  v_contact_id uuid;
  v_deal_id    uuid;
  v_owner      uuid;
begin
  if not public.is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'Lead introuvable' using errcode = 'P0002';
  end if;

  if v_lead.converted_deal_id is not null then
    return jsonb_build_object(
      'deal_id', v_lead.converted_deal_id,
      'company_id', v_lead.converted_company_id,
      'contact_id', v_lead.converted_contact_id,
      'already_converted', true
    );
  end if;

  v_owner := coalesce(p_owner_id, v_lead.owner_id, auth.uid());

  -- Entreprise : on réutilise une fiche existante au même nom si elle existe.
  if coalesce(trim(v_lead.company_name), '') <> '' then
    select id into v_company_id
    from public.companies
    where lower(name) = lower(trim(v_lead.company_name))
    limit 1;
  end if;

  if v_company_id is null then
    insert into public.companies
      (name, website, sector, activity, region, address, revenue, linkedin_url, owner_id, created_by)
    values
      (coalesce(nullif(trim(v_lead.company_name), ''), coalesce(v_lead.full_name, 'Entreprise sans nom')),
       v_lead.company_website, v_lead.sector, v_lead.company_activity, v_lead.region,
       v_lead.address, v_lead.revenue, null, v_owner, auth.uid())
    returning id into v_company_id;
  end if;

  -- Contact : dédoublonnage sur l'email au sein de l'entreprise.
  if coalesce(trim(v_lead.email), '') <> '' then
    select id into v_contact_id
    from public.contacts
    where lower(email) = lower(trim(v_lead.email))
    limit 1;
  end if;

  if v_contact_id is null then
    insert into public.contacts
      (company_id, first_name, last_name, email, phone, linkedin_url, notes, is_primary, owner_id, created_by)
    values
      (v_company_id, v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone,
       v_lead.linkedin_url, v_lead.comment, true, v_owner, auth.uid())
    returning id into v_contact_id;
  end if;

  insert into public.deals
    (name, company_id, contact_id, stage, amount, owner_id, source_lead_id, description, created_by, position)
  values
    (coalesce(nullif(trim(p_deal_name), ''),
              coalesce(nullif(trim(v_lead.company_name), ''), v_lead.full_name, 'Nouvelle affaire')),
     v_company_id, v_contact_id, 'demande_rdv_envoyee', p_amount, v_owner, v_lead.id, v_lead.comment,
     auth.uid(),
     coalesce((select min(position) - 100 from public.deals where stage = 'demande_rdv_envoyee'), 1000))
  returning id into v_deal_id;

  update public.leads
  set status = 'call_pris',
      converted_at = now(),
      converted_deal_id = v_deal_id,
      converted_company_id = v_company_id,
      converted_contact_id = v_contact_id
  where id = p_lead_id;

  insert into public.activities (entity_type, entity_id, action, payload, actor_id)
  values ('deal', v_deal_id, 'deal.created_from_lead',
          jsonb_build_object('lead_id', p_lead_id, 'company_id', v_company_id), auth.uid());

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'company_id', v_company_id,
    'contact_id', v_contact_id,
    'already_converted', false
  );
end;
$$;

revoke all on function public.convert_lead_to_deal(uuid, text, numeric, uuid) from public;
grant execute on function public.convert_lead_to_deal(uuid, text, numeric, uuid) to authenticated;

-- --- Avancement des projets ---------------------------------------------
-- security_invoker : la vue applique la RLS de l'appelant, donc un client n'y
-- voit que les tâches qui lui sont explicitement partagées.
create or replace view public.project_progress
with (security_invoker = on) as
select
  p.id                                                      as project_id,
  count(t.id) filter (where t.kind = 'production')          as tasks_total,
  count(t.id) filter (where t.kind = 'production' and t.status = 'termine') as tasks_done,
  count(t.id) filter (where t.kind = 'jalon')               as milestones_total,
  count(t.id) filter (where t.kind = 'jalon' and t.status = 'termine')      as milestones_done,
  count(t.id) filter (where t.status <> 'termine' and t.due_on < current_date) as tasks_overdue,
  min(t.due_on) filter (where t.status <> 'termine')        as next_due_on,
  case
    when count(t.id) filter (where t.kind = 'production') = 0 then 0
    else round(
      100.0 * count(t.id) filter (where t.kind = 'production' and t.status = 'termine')
      / count(t.id) filter (where t.kind = 'production')
    )::int
  end                                                       as progress_pct
from public.projects p
left join public.tasks t on t.project_id = p.id
group by p.id;

grant select on public.project_progress to authenticated;

-- --- Stockage des documents ---------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do nothing;

-- Chemin attendu : projects/<project_id>/<fichier> ou deals/<deal_id>/<fichier>.
create policy "documents_storage_staff_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and public.is_staff())
  with check (bucket_id = 'documents' and public.is_staff());

create policy "documents_storage_client_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and public.current_role() = 'client'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.is_client_visible
        and d.project_id is not null
        and public.client_can_see_project(d.project_id)
    )
  );

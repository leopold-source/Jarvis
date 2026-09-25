-- Les tâches du quotidien de l'équipe.
--
-- À côté des chantiers, qui portent un objectif business mesuré, il faut une
-- liste légère : « créer le mail type », « ajouter hors cible », assignée à
-- l'un, à l'autre ou aux deux, rangée par catégorie libre. Les chantiers ne
-- changent pas ; une tâche peut s'y rattacher, ou à une affaire, sans y être
-- obligée.

create type public.todo_statut as enum ('a_faire', 'en_cours', 'en_attente', 'probleme', 'fait');

create table public.todos (
  id           uuid primary key default gen_random_uuid(),
  titre        text not null check (length(trim(titre)) > 0),
  details      text,
  categorie    text,
  statut       public.todo_statut not null default 'a_faire',
  prio         boolean not null default false,
  assignee_ids uuid[] not null default '{}',
  due_on       date,
  deal_id      uuid references public.deals (id) on delete set null,
  chantier_id  uuid references public.chantiers (id) on delete set null,
  position     double precision not null default 0,
  done_at      timestamptz,
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index todos_statut_idx on public.todos (statut, due_on);
create index todos_assignees_idx on public.todos using gin (assignee_ids);

create table public.todo_comments (
  id         uuid primary key default gen_random_uuid(),
  todo_id    uuid not null references public.todos (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index todo_comments_todo_idx on public.todo_comments (todo_id, created_at);

create trigger todos_touch before update on public.todos
  for each row execute function public.touch_updated_at();

-- « Fait » se date tout seul, et se dé-date si on rouvre la tâche.
create or replace function public.todos_done_at()
returns trigger language plpgsql as $$
begin
  if new.statut = 'fait' and (tg_op = 'INSERT' or old.statut <> 'fait') then
    new.done_at := now();
  elsif new.statut <> 'fait' then
    new.done_at := null;
  end if;
  return new;
end;
$$;

create trigger todos_done_at before insert or update of statut on public.todos
  for each row execute function public.todos_done_at();

alter table public.todos enable row level security;
alter table public.todo_comments enable row level security;

create policy "todos_staff" on public.todos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "todo_comments_select_staff" on public.todo_comments for select to authenticated
  using (public.is_staff());
create policy "todo_comments_insert_staff" on public.todo_comments for insert to authenticated
  with check (public.is_staff() and author_id = auth.uid());
-- Chacun ne retire que ses propres commentaires.
create policy "todo_comments_delete_own" on public.todo_comments for delete to authenticated
  using (author_id = auth.uid());

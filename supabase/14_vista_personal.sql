-- =====================================================================
--  TEAM COACH · Cambio 20: login para todo el equipo ("Mi espacio")
--  · Nuevo rol 'member' (persona del equipo): ve SOLO lo suyo.
--      perfil, horas/goals/estudio/vacaciones de Bamboo, sus incidencias,
--      sus reuniones (fecha, resumen y acuerdos), sus pendientes y
--      las notas que su líder marcó como "Visible para la persona".
--    Nunca ve a su líder ni a sus compañeros, ni el banco de ideas, ni la IA.
--  · Notas: el líder decide nota por nota si la persona la ve (por defecto, no).
--  · Comentarios en pendientes (el líder y la persona).
--  Correr después de 13_campana.sql. Se puede correr más de una vez.
-- =====================================================================

-- 1) Rol nuevo
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','lead','member'));

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'member');
$$;
grant execute on function public.is_member() to authenticated;

-- 2) A quién ve: una persona del equipo, solo a sí misma (aunque esté cargada como líder de algún grupo)
create or replace function public.can_see_person(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_admin()
    or (p is not null and p = public.my_person_id())
    or (not public.is_member() and exists (
      select 1 from public.people x
      where x.id = p and x.group_id in (select public.my_group_ids())
    ));
$$;

-- Bamboo: una persona del equipo ve solo su propio registro (aunque en Bamboo tenga gente debajo)
create or replace function public.bamboo_visible() returns text[]
language sql stable security definer set search_path = public as $$
  with recursive cadena as (
    select e.bamboo_id, 0 as nivel from public.bamboo_employees e where e.bamboo_id = public.my_bamboo_id()
    union
    select e.bamboo_id, c.nivel + 1 from public.bamboo_employees e
    join cadena c on e.supervisor_id = c.bamboo_id
    where c.nivel < 20 and not public.is_member()
  )
  select coalesce(array_agg(distinct bamboo_id), '{}') from cadena;
$$;

-- 3) Notas: "Visible para la persona" (por defecto no). Una nota privada nunca es visible.
-- La primera vez: para que nada cambie a los líderes, las notas no privadas que ya veían sobre sí mismos quedan visibles.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'insights' and column_name = 'shared_with_person') then
    alter table public.insights add column shared_with_person boolean not null default false;
    update public.insights set shared_with_person = true where not private and public.is_lead_person(person_id);
  end if;
end $$;

create or replace function public.insights_share_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.private then new.shared_with_person := false; end if;
  return new;
end; $$;
drop trigger if exists insights_share_guard on public.insights;
create trigger insights_share_guard before insert or update on public.insights
  for each row execute function public.insights_share_guard();

-- Sobre uno mismo: solo las marcadas como visibles
drop policy if exists insights_select on public.insights;
create policy insights_select on public.insights for select to authenticated
  using (public.is_admin()
         or (not private and public.can_read_about(person_id)
             and (person_id is distinct from public.my_person_id() or shared_with_person)));

-- 4) Pendientes: la persona ve solo los que tiene a cargo (no los del líder sobre ella) y no crea
drop policy if exists actions_select on public.actions;
create policy actions_select on public.actions for select to authenticated
  using (public.is_admin()
         or (not private and ((not public.is_member() and public.can_read_about(person_id))
                              or owner_id = public.my_person_id())));
drop policy if exists actions_insert on public.actions;
create policy actions_insert on public.actions for insert to authenticated
  with check (public.is_admin()
              or (not private and not public.is_member()
                  and (person_id = public.my_person_id() or public.can_write_about(person_id))));

-- 5) Sin plan de coaching, banco de ideas ni reuniones propias para la persona
drop policy if exists sugg_select on public.suggestions;
create policy sugg_select on public.suggestions for select to authenticated
  using (public.is_admin() or (not public.is_member() and status in ('validada','en uso') and public.can_read_about(person_id)));
drop policy if exists ideas_select on public.ideas;
create policy ideas_select on public.ideas for select to authenticated using (not public.is_member());
drop policy if exists ideas_insert on public.ideas;
create policy ideas_insert on public.ideas for insert to authenticated
  with check (public.is_admin() or (created_by = auth.uid() and not public.is_member()));
drop policy if exists meetings_lead_insert on public.meetings;
create policy meetings_lead_insert on public.meetings for insert to authenticated
  with check (created_by = auth.uid() and not public.is_member()
              and (person_id = public.my_person_id() or public.can_write_about(person_id)));

-- 6) Mis reuniones: fecha, resumen (cuando ya está revisada) y acuerdos a mi cargo. Nunca transcripción ni análisis.
create or replace function public.my_meetings()
returns table (id uuid, meeting_date date, kind text, summary text, status text, acuerdos jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.meeting_date, m.kind,
         case when m.status = 'aplicado' then m.summary end,
         m.status,
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'body', a.body, 'due_date', a.due_date, 'status', a.status) order by a.created_at)
                   from public.actions a
                   where a.meeting_id = m.id and not a.private and a.owner_id = public.my_person_id()), '[]'::jsonb)
  from public.meetings m
  where public.is_member() and m.person_id = public.my_person_id()
  order by m.meeting_date desc;
$$;
revoke all on function public.my_meetings() from anon;
grant execute on function public.my_meetings() to authenticated;

-- 7) Comentarios en pendientes: los ve y escribe quien ve el pendiente
create table if not exists public.action_comments (
  id          uuid primary key default gen_random_uuid(),
  action_id   uuid not null references public.actions(id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  author_id   uuid default auth.uid(),
  author_name text,
  created_at  timestamptz not null default now()
);
create index if not exists action_comments_action on public.action_comments (action_id, created_at);
alter table public.action_comments enable row level security;
revoke all on public.action_comments from anon;
grant select, insert, delete on public.action_comments to authenticated;

create or replace function public.action_comments_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    new.author_name := public.my_display_name();
    new.created_at := now();
  end if;
  new.body := trim(new.body);
  return new;
end; $$;
drop trigger if exists action_comments_stamp on public.action_comments;
create trigger action_comments_stamp before insert on public.action_comments
  for each row execute function public.action_comments_stamp();

drop policy if exists action_comments_select on public.action_comments;
create policy action_comments_select on public.action_comments for select to authenticated
  using (exists (select 1 from public.actions a where a.id = action_id));
drop policy if exists action_comments_insert on public.action_comments;
create policy action_comments_insert on public.action_comments for insert to authenticated
  with check (exists (select 1 from public.actions a where a.id = action_id));
drop policy if exists action_comments_delete on public.action_comments;
create policy action_comments_delete on public.action_comments for delete to authenticated
  using (public.is_admin() or author_id = auth.uid());

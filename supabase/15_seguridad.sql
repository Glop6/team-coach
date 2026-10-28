-- =====================================================================
--  TEAM COACH · Cambio 21: ajustes de seguridad (revisión del 27/10/2026)
--  1. El registro de sincronizaciones (nombres, correos, avisos) lo ve solo Gus.
--     Los demás ven solo "actualizado hace X" con last_sync().
--  2. Una cuenta creada por fuera de Accesos nace como "Persona" (no como Lead).
--  3. Desactivar acceso: bloquea el login (función coach) y una sesión abierta deja de ver datos.
--  4. La persona del equipo ya no recibe los "temas para la próxima reunión".
--  Correr después de 14_vista_personal.sql. Se puede correr más de una vez.
--  IMPORTANTE: no vuelvas a correr archivos viejos (01–14) sueltos: deshacen protecciones.
-- =====================================================================

alter table public.profiles add column if not exists disabled boolean not null default false;

-- 1) Registro de sincronizaciones: solo Gus
drop policy if exists bamboo_sync_log_select on public.bamboo_sync_log;
create policy bamboo_sync_log_select on public.bamboo_sync_log for select to authenticated using (public.is_admin());

create or replace function public.last_sync()
returns table (finished_at timestamptz, ok boolean)
language sql stable security definer set search_path = public as $$
  select l.finished_at, l.ok from public.bamboo_sync_log l
  where auth.uid() is not null and l.ok and l.finished_at is not null
  order by l.finished_at desc limit 1;
$$;
revoke all on function public.last_sync() from public, anon;
grant execute on function public.last_sync() to authenticated;

-- 2) Cuentas nuevas: "Persona" por defecto (Accesos asigna Lead a los líderes)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  admin_emails text[] := array['clopezgustavo@gmail.com'];
  is_adm boolean := lower(new.email) = any (select lower(unnest(admin_emails)));
begin
  insert into public.profiles (id, email, role, person_id, must_change_password)
  values (new.id, new.email, case when is_adm then 'admin' else 'member' end,
          (select id from public.people where lower(email) = lower(new.email) limit 1), false)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3) Desactivar acceso: la función coach bloquea el login; además, una sesión que siga abierta deja de ver datos
create or replace function public.my_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select person_id from public.profiles where id = auth.uid() and not disabled;
$$;
create or replace function public.my_group_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select gl.group_id from public.group_leads gl
  where gl.person_id = (select person_id from public.profiles where id = auth.uid() and not disabled);
$$;
create or replace function public.my_bamboo_id() returns text
language sql stable security definer set search_path = public as $$
  select p.bamboo_id from public.people p
  join public.profiles pr on pr.id = auth.uid() and pr.person_id = p.id and not pr.disabled;
$$;

-- 4) Reuniones que Gus comparte: solo para líderes (la persona usa my_meetings: fecha, resumen y acuerdos)
create or replace function public.shared_meetings()
returns table (id uuid, meeting_date date, kind text, person_id uuid, title text, summary text,
               status text, next_topics jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.meeting_date, m.kind, m.person_id, m.title, m.summary, m.status,
         m.analysis -> 'next_meeting_topics', m.created_at
  from public.meetings m
  join public.profiles pr on pr.id = m.created_by and pr.role = 'admin'
  where m.shared_with_lead and m.status = 'aplicado'
    and m.person_id = public.my_person_id()
    and not public.is_member();
$$;

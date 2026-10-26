-- =====================================================================
--  TEAM COACH · Cambio 16: editar notas después de la reunión
--  · Gus puede editar cualquier nota.
--  · Cada líder puede editar las notas de SU gente (las que puede ver: no privadas,
--    no de otros líderes ni de sí mismo), aunque las haya escrito otro o salgan de una reunión.
--  · No se puede cambiar de quién es la nota, ni de qué persona, ni volverla privada.
--  · Cada edición queda guardada (antes / después, quién y cuándo); Gus la ve.
--  Correr después de 09_feriados_regionales.sql. Se puede correr más de una vez.
-- =====================================================================
alter table public.insights add column if not exists edited_at timestamptz;
alter table public.insights add column if not exists edited_by uuid;
alter table public.insights add column if not exists edited_by_name text;

create table if not exists public.insight_edits (
  id          bigserial primary key,
  insight_id  uuid references public.insights(id) on delete cascade,
  person_id   uuid,
  old_kind    text,
  new_kind    text,
  old_body    text,
  new_body    text,
  by_user     uuid,
  by_name     text,
  at          timestamptz not null default now()
);
alter table public.insight_edits enable row level security;
revoke all on public.insight_edits from anon;
revoke insert, update, delete on public.insight_edits from authenticated;
grant select on public.insight_edits to authenticated;
drop policy if exists insight_edits_admin on public.insight_edits;
create policy insight_edits_admin on public.insight_edits for select to authenticated using (public.is_admin());

-- Quién edita y qué cambió (no se puede falsear desde la app)
create or replace function public.insights_edit_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := old.author_id;                       -- la nota sigue siendo de quien la escribió
  if not public.is_admin() then
    new.private := old.private;
    new.meeting_id := old.meeting_id;
    new.created_at := old.created_at;
  end if;
  if new.body is distinct from old.body or new.kind is distinct from old.kind or new.category is distinct from old.category then
    new.edited_at := now();
    new.edited_by := auth.uid();
    new.edited_by_name := public.my_display_name();
    insert into public.insight_edits (insight_id, person_id, old_kind, new_kind, old_body, new_body, by_user, by_name)
    values (old.id, old.person_id, old.kind, new.kind, old.body, new.body, auth.uid(), public.my_display_name());
  else
    new.edited_at := old.edited_at; new.edited_by := old.edited_by; new.edited_by_name := old.edited_by_name;
  end if;
  return new;
end;
$$;
drop trigger if exists insights_edit_stamp on public.insights;
create trigger insights_edit_stamp before update on public.insights
  for each row execute function public.insights_edit_stamp();

-- Editar: Gus, el autor, o el líder de esa persona (si la nota no es privada)
drop policy if exists insights_update on public.insights;
create policy insights_update on public.insights for update to authenticated
  using (public.is_admin() or author_id = auth.uid() or (not private and public.can_write_about(person_id)))
  with check (public.is_admin() or (not private and public.can_write_about(person_id)));

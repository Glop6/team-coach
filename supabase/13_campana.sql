-- =====================================================================
--  TEAM COACH · Cambio 19: campanita, incidencias propias y reactivar
--  · Cada uno ve SUS incidencias (solo lectura) y las nuevas le aparecen en la campanita.
--  · Reactivar: Gus cualquiera; un líder solo las que él mismo anuló. Queda historial.
--  · "Visto": cada usuario marca hasta cuándo revisó (para contar lo nuevo).
--  Correr después de 12_incidencias.sql. Se puede correr más de una vez.
-- =====================================================================
alter table public.incidents add column if not exists history jsonb not null default '[]'::jsonb;

-- Ver: además de lo de su gente, cada uno ve las suyas (no las puede anular ni editar)
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents for select to authenticated
  using (public.can_see_incident(person_id, bamboo_id)
         or (person_id is not null and person_id = public.my_person_id())
         or (bamboo_id is not null and bamboo_id = public.my_bamboo_id()));

-- Reactivar con reglas e historial (reemplaza la función del Cambio 18)
create or replace function public.incidents_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.source := 'manual';
      new.created_by := auth.uid();
      new.created_by_name := public.my_display_name();
      new.created_at := now();
      new.voided := false; new.void_reason := null; new.voided_by := null; new.voided_by_name := null; new.voided_at := null;
      new.notified_at := null; new.notified_by_name := null;
      new.history := '[]'::jsonb;
    end if;
    return new;
  end if;
  -- UPDATE
  if auth.uid() is not null and not public.is_admin() then
    new.person_id := old.person_id; new.bamboo_id := old.bamboo_id; new.source := old.source;
    new.week_start := old.week_start; new.detail := old.detail;
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
    new.history := old.history;
    if old.source = 'bamboo' or old.created_by is distinct from auth.uid() then
      new.category := old.category; new.severity := old.severity; new.occurred_on := old.occurred_on; new.note := old.note;
    end if;
    if old.voided and not new.voided and old.voided_by is distinct from auth.uid() then
      raise exception 'Solo puedes reactivar las incidencias que anulaste tú. Las demás las reactiva Gus.';
    end if;
  end if;
  if new.voided and not old.voided then
    if coalesce(trim(new.void_reason), '') = '' then
      raise exception 'Para anular una incidencia hay que escribir el motivo.';
    end if;
    new.voided_by := auth.uid(); new.voided_by_name := public.my_display_name(); new.voided_at := now();
    new.history := coalesce(old.history, '[]'::jsonb) || jsonb_build_object('accion', 'anulada', 'por', public.my_display_name(), 'cuando', now(), 'motivo', trim(new.void_reason));
  elsif old.voided and not new.voided then
    new.history := coalesce(old.history, '[]'::jsonb) || jsonb_build_object('accion', 'reactivada', 'por', public.my_display_name(), 'cuando', now());
    new.void_reason := null; new.voided_by := null; new.voided_by_name := null; new.voided_at := null;
  elsif new.voided then
    new.void_reason := old.void_reason; new.voided_by := old.voided_by; new.voided_by_name := old.voided_by_name; new.voided_at := old.voided_at;
  end if;
  if new.notified_at is distinct from old.notified_at then
    new.notified_at := old.notified_at; new.notified_by_name := old.notified_by_name;   -- "Avisar" queda en pausa
  end if;
  return new;
end;
$$;

-- Hasta cuándo revisó cada usuario cada sección (para la campanita)
create table if not exists public.user_seen (
  user_id  uuid not null default auth.uid(),
  kind     text not null,
  seen_at  timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.user_seen enable row level security;
revoke all on public.user_seen from anon;
grant select, insert, update on public.user_seen to authenticated;
drop policy if exists user_seen_own on public.user_seen;
create policy user_seen_own on public.user_seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

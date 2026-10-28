-- =====================================================================
--  TEAM COACH · Cambio 22: inglés por defecto y kudos
--  · Todos pasan a ver la app en inglés (cada uno puede volver a ES con el botón).
--  · Kudos: mensajes positivos en la misma sección que las incidencias.
--    Mismos permisos que las incidencias; no cuentan para el umbral.
--  Correr después de 15_seguridad.sql. Se puede correr más de una vez.
--  IMPORTANTE: no vuelvas a correr archivos viejos (01–15) sueltos: deshacen protecciones.
-- =====================================================================

-- 1) Idioma: inglés por defecto (la primera vez pasa a todos a inglés)
do $$ begin
  if (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'lang') like '%es%' then
    update public.profiles set lang = 'en';
    alter table public.profiles alter column lang set default 'en';
  end if;
end $$;
create or replace function public.set_lang(l text) returns void
language sql security definer set search_path = public as $$
  update public.profiles set lang = case when l in ('es','en') then l else 'en' end where id = auth.uid();
$$;

-- 2) Kudos
alter table public.incidents add column if not exists kind text not null default 'incidencia';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'incidents_kind_check') then
    alter table public.incidents add constraint incidents_kind_check check (kind in ('incidencia', 'kudos'));
  end if;
end $$;

-- Reglas de siempre (Cambio 19) + nadie que no sea Gus cambia una incidencia a kudos o al revés
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
    new.kind := old.kind;                                   -- una incidencia no pasa a kudos (ni al revés)
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

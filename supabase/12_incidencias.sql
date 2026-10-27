-- =====================================================================
--  TEAM COACH · Cambio 18: incidencias
--  · Registro único de incidencias para el coaching: manuales (las anota el líder) y
--    automáticas de Bamboo (cada lunes 8:00, una por persona y semana si la semana anterior
--    quedó con días sin llenar, incompletos o con horas en día libre sin comentario).
--  · Nunca se borran: se anulan con motivo, quién y cuándo. Gus ve todas las anulaciones.
--  · Lo ve Gus y el líder de la persona (no las suyas propias).
--  Correr después de 11_historial_ia.sql. Se puede correr más de una vez.
-- =====================================================================
create table if not exists public.incidents (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid references public.people(id) on delete cascade,
  bamboo_id        text,
  source           text not null default 'manual' check (source in ('manual', 'bamboo')),
  category         text not null,
  severity         text not null default 'leve' check (severity in ('leve', 'moderada', 'critica')),
  occurred_on      date not null default current_date,
  week_start       date,
  detail           text,
  note             text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  voided           boolean not null default false,
  void_reason      text,
  voided_by        uuid,
  voided_by_name   text,
  voided_at        timestamptz,
  notified_at      timestamptz,
  notified_by_name text,
  constraint incidents_who_check check (person_id is not null or bamboo_id is not null),
  constraint incidents_week_key unique (source, bamboo_id, week_start)
);
create index if not exists incidents_person_idx on public.incidents(person_id, occurred_on desc);
create index if not exists incidents_bamboo_idx on public.incidents(bamboo_id, occurred_on desc);

-- Umbral de alerta por mes y desde qué semana se generan las automáticas (no hacia atrás)
insert into public.rule_config (key, value) values
  ('incident_threshold', '3'),
  ('incidents_from', to_jsonb(to_char(date_trunc('week', now() at time zone 'America/La_Paz'), 'YYYY-MM-DD')))
on conflict (key) do nothing;

-- ¿Puede ver/gestionar esta incidencia? Gus todo; el líder, su gente (por Team Coach o por Bamboo), no lo suyo
create or replace function public.can_see_incident(p uuid, b text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (p is not null and public.can_write_about(p))
      or (b is not null and b in (select unnest(public.bamboo_visible())) and b is distinct from public.my_bamboo_id()
          and (p is null or p is distinct from public.my_person_id()));
$$;
grant execute on function public.can_see_incident(uuid, text) to authenticated;

-- Quién / cuándo, anulación con motivo y campos protegidos
create or replace function public.incidents_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then                    -- desde la app (la función de Bamboo usa la llave de servicio)
      new.source := 'manual';
      new.created_by := auth.uid();
      new.created_by_name := public.my_display_name();
      new.created_at := now();
      new.voided := false; new.void_reason := null; new.voided_by := null; new.voided_by_name := null; new.voided_at := null;
      new.notified_at := null; new.notified_by_name := null;
    end if;
    return new;
  end if;
  -- UPDATE
  if auth.uid() is not null and not public.is_admin() then
    -- lo que no se puede cambiar: de quién es, el origen y el detalle automático
    new.person_id := old.person_id; new.bamboo_id := old.bamboo_id; new.source := old.source;
    new.week_start := old.week_start; new.detail := old.detail;
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
    -- solo quien la creó (manual) puede corregir categoría, gravedad, fecha o nota
    if old.source = 'bamboo' or old.created_by is distinct from auth.uid() then
      new.category := old.category; new.severity := old.severity; new.occurred_on := old.occurred_on; new.note := old.note;
    end if;
    if old.voided and not new.voided then
      raise exception 'Solo Gus puede reactivar una incidencia anulada.';
    end if;
  end if;
  if new.voided and not old.voided then
    if coalesce(trim(new.void_reason), '') = '' then
      raise exception 'Para anular una incidencia hay que escribir el motivo.';
    end if;
    new.voided_by := auth.uid(); new.voided_by_name := public.my_display_name(); new.voided_at := now();
  elsif not new.voided then
    new.void_reason := null; new.voided_by := null; new.voided_by_name := null; new.voided_at := null;
  else
    new.void_reason := old.void_reason; new.voided_by := old.voided_by; new.voided_by_name := old.voided_by_name; new.voided_at := old.voided_at;
  end if;
  if new.notified_at is distinct from old.notified_at then
    new.notified_at := now(); new.notified_by_name := public.my_display_name();
  end if;
  return new;
end;
$$;
drop trigger if exists incidents_stamp on public.incidents;
create trigger incidents_stamp before insert or update on public.incidents
  for each row execute function public.incidents_stamp();

alter table public.incidents enable row level security;
revoke all on public.incidents from anon;
revoke delete on public.incidents from authenticated;          -- nunca se borran desde la app
grant select, insert, update on public.incidents to authenticated;

drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents for select to authenticated
  using (public.can_see_incident(person_id, bamboo_id));
drop policy if exists incidents_insert on public.incidents;
create policy incidents_insert on public.incidents for insert to authenticated
  with check (person_id is not null and public.can_see_incident(person_id, bamboo_id));
drop policy if exists incidents_update on public.incidents;
create policy incidents_update on public.incidents for update to authenticated
  using (public.can_see_incident(person_id, bamboo_id))
  with check (public.can_see_incident(person_id, bamboo_id));

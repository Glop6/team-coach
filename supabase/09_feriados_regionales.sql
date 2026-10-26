-- =====================================================================
--  TEAM COACH · Cambio 15: feriados regionales y feriados por persona
--  · Bolivia: cada persona toma UN feriado regional (La Paz, Cochabamba o Santa Cruz),
--    según su ciudad. Por defecto La Paz.
--  · Los líderes ven los feriados del país de cada persona de su equipo, eligen la ciudad
--    y pueden mover un feriado a otra fecha. No pueden cambiar los suyos (eso lo hace
--    su líder o Gus).
--  · Cada cambio queda registrado (quién y cuándo) y Gus lo revisa en Reglas → Cambios.
--  Correr después de 06_bamboo.sql. Se puede correr más de una vez.
-- =====================================================================

-- Feriados regionales: misma tabla, con la región
alter table public.rule_holidays add column if not exists region text;

insert into public.rule_holidays (country, day, name, fraction, region) values
  ('bolivia', '2026-07-16', 'Día de La Paz', 1, 'La Paz'),
  ('bolivia', '2026-09-14', 'Día de Cochabamba', 1, 'Cochabamba'),
  ('bolivia', '2026-09-24', 'Día de Santa Cruz', 1, 'Santa Cruz')
on conflict (country, day) do update set region = excluded.region, name = excluded.name, fraction = excluded.fraction;

-- Región por defecto por país
insert into public.rule_config (key, value) values ('default_regions', '{"bolivia": "La Paz"}')
on conflict (key) do nothing;

-- Ciudad elegida por persona
create table if not exists public.holiday_choices (
  bamboo_id        text primary key references public.bamboo_employees(bamboo_id) on delete cascade,
  region           text not null,
  changed_by       uuid,
  changed_by_name  text,
  changed_at       timestamptz not null default now()
);

-- Feriado movido a otra fecha (por persona)
create table if not exists public.holiday_moves (
  id               uuid primary key default gen_random_uuid(),
  bamboo_id        text not null references public.bamboo_employees(bamboo_id) on delete cascade,
  original_day     date not null,
  new_day          date not null,
  note             text,
  changed_by       uuid,
  changed_by_name  text,
  changed_at       timestamptz not null default now(),
  unique (bamboo_id, original_day),
  constraint holiday_moves_days_check check (original_day <> new_day)
);

-- Registro de cambios (solo lo ve Gus)
create table if not exists public.rule_changes (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  by_user      uuid,
  by_name      text,
  bamboo_id    text,
  person_name  text,
  kind         text not null,
  detail       text
);

-- Quién está haciendo el cambio (nombre legible)
create or replace function public.my_display_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from public.profiles pr join public.people p on p.id = pr.person_id where pr.id = auth.uid()),
    (select case when pr.role = 'admin' then 'Gus' else pr.email end from public.profiles pr where pr.id = auth.uid()),
    'Sistema');
$$;

-- Completa quién/cuándo (no se puede falsear desde la app) y valida
create or replace function public.holiday_rules_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_country text;
begin
  new.changed_by := auth.uid();
  new.changed_by_name := public.my_display_name();
  new.changed_at := now();
  select country into v_country from public.bamboo_employees where bamboo_id = new.bamboo_id;
  if tg_table_name = 'holiday_choices' then
    if not exists (select 1 from public.rule_holidays where country = v_country and region = new.region) then
      raise exception 'La ciudad "%" no tiene feriado cargado para este país.', new.region;
    end if;
  else
    if not exists (select 1 from public.rule_holidays where country = v_country and day = new.original_day) then
      raise exception 'El % no es feriado en el país de esta persona.', new.original_day;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists holiday_choices_stamp on public.holiday_choices;
create trigger holiday_choices_stamp before insert or update on public.holiday_choices
  for each row execute function public.holiday_rules_stamp();
drop trigger if exists holiday_moves_stamp on public.holiday_moves;
create trigger holiday_moves_stamp before insert or update on public.holiday_moves
  for each row execute function public.holiday_rules_stamp();

create or replace function public.holiday_rules_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_name text; v_detail text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select full_name into v_name from public.bamboo_employees where bamboo_id = r.bamboo_id;
  if tg_table_name = 'holiday_choices' then
    v_detail := case tg_op
      when 'DELETE' then 'Vuelve a la ciudad por defecto (antes ' || old.region || ')'
      when 'UPDATE' then 'Ciudad: ' || old.region || ' → ' || new.region
      else 'Ciudad: ' || new.region end;
  else
    v_detail := case tg_op
      when 'DELETE' then 'Quitó el cambio de feriado ' || to_char(old.original_day, 'DD/MM') || ' → ' || to_char(old.new_day, 'DD/MM')
      else 'Feriado ' || to_char(new.original_day, 'DD/MM') || ' movido al ' || to_char(new.new_day, 'DD/MM')
           || coalesce(' · ' || nullif(new.note, ''), '') end;
  end if;
  insert into public.rule_changes (by_user, by_name, bamboo_id, person_name, kind, detail)
  values (auth.uid(), public.my_display_name(), r.bamboo_id, v_name,
          case when tg_table_name = 'holiday_choices' then 'ciudad' else 'feriado movido' end, v_detail);
  return null;
end;
$$;

drop trigger if exists holiday_choices_log on public.holiday_choices;
create trigger holiday_choices_log after insert or update or delete on public.holiday_choices
  for each row execute function public.holiday_rules_log();
drop trigger if exists holiday_moves_log on public.holiday_moves;
create trigger holiday_moves_log after insert or update or delete on public.holiday_moves
  for each row execute function public.holiday_rules_log();

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
alter table public.holiday_choices enable row level security;
alter table public.holiday_moves enable row level security;
alter table public.rule_changes enable row level security;
revoke all on public.holiday_choices, public.holiday_moves, public.rule_changes from anon;
grant select, insert, update, delete on public.holiday_choices, public.holiday_moves to authenticated;
revoke insert, update, delete on public.rule_changes from authenticated;
grant select on public.rule_changes to authenticated;

-- Ver: Gus todo; cada líder, su cadena (incluido él mismo)
-- Cambiar: Gus todo; cada líder, su cadena MENOS él mismo
do $$ declare t text; begin
  foreach t in array array['holiday_choices', 'holiday_moves'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin() or bamboo_id in (select unnest(public.bamboo_visible())))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin() or (bamboo_id in (select unnest(public.bamboo_visible())) and bamboo_id is distinct from public.my_bamboo_id())) with check (public.is_admin() or (bamboo_id in (select unnest(public.bamboo_visible())) and bamboo_id is distinct from public.my_bamboo_id()))', t || '_write', t);
  end loop;
end $$;

drop policy if exists rule_changes_admin on public.rule_changes;
create policy rule_changes_admin on public.rule_changes for select to authenticated using (public.is_admin());

-- Los feriados y la configuración no son datos sensibles: los líderes pueden leerlos (no editarlos)
drop policy if exists rule_holidays_read on public.rule_holidays;
create policy rule_holidays_read on public.rule_holidays for select to authenticated using (true);
drop policy if exists rule_config_read on public.rule_config;
create policy rule_config_read on public.rule_config for select to authenticated using (true);

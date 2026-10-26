-- =====================================================================
--  TEAM COACH · Cambio 13: integración con BambooHR
--  (pega en SQL Editor → Run; se puede correr más de una vez sin romper nada)
--
--  · Tablas con lo que trae la función "bamboo-sync" desde Bamboo:
--    empleados (con su supervisor), horas día por día, goals, training y vacaciones.
--    Solo la función (con la llave de servicio) escribe en ellas.
--  · Cada líder ve SOLO a la gente que tiene debajo en Bamboo (toda su cadena);
--    Gus (admin) ve todo.
--  · Reglas editables solo por Gus: horarios especiales, feriados por país,
--    excluidos y configuración (proyecto principal, horas por día...).
-- =====================================================================

-- Enlace persona de Team Coach ↔ empleado de Bamboo
alter table public.people add column if not exists bamboo_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'people_bamboo_id_key') then
    alter table public.people add constraint people_bamboo_id_key unique (bamboo_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Datos que trae la sincronización
-- ---------------------------------------------------------------------
create table if not exists public.bamboo_employees (
  bamboo_id      text primary key,
  full_name      text not null,
  email          text,
  supervisor_id  text,
  country        text,                 -- país normalizado (minúsculas), para feriados
  info           text,                 -- "Bolivia · Horario jue a lun"
  person_id      uuid references public.people(id) on delete set null,
  ai_obs         jsonb,                -- lo que dijo la IA sobre sus comentarios {estado, observacion}
  obs            jsonb,                -- observaciones (IA + sistema) con sus fechas
  updated_at     timestamptz not null default now()
);
alter table public.bamboo_employees add column if not exists obs jsonb;
create index if not exists bamboo_employees_sup_idx on public.bamboo_employees(supervisor_id);

create table if not exists public.bamboo_days (
  bamboo_id       text not null references public.bamboo_employees(bamboo_id) on delete cascade,
  day             date not null,
  hours           numeric not null default 0,   -- horas del proyecto principal
  expected        numeric not null default 0,
  state           text not null,                -- ok, falta, parcial, exceso, extra, esperado, justificado, en_plazo, descanso
  label           text,                         -- Feriado, ½ PTO...
  reason          text,                         -- motivo (feriado / PTO / horario)
  note            text,                         -- comentario del registro
  other_projects  jsonb,                        -- {"Shipley Do-nuts": 8}
  ai              text,                         -- explicación de la IA si lo justificó
  holiday         text,
  pto             text,
  rest            boolean not null default false,
  before_state    jsonb,                        -- cómo estaba antes de corregirse {state, hours, seen}
  seen            date,
  primary key (bamboo_id, day)
);
create index if not exists bamboo_days_day_idx on public.bamboo_days(day);

create table if not exists public.bamboo_goals (
  bamboo_id   text not null references public.bamboo_employees(bamboo_id) on delete cascade,
  goal_id     text not null,
  title       text not null,
  pct         numeric not null default 0,
  due         date,
  completed   date,
  state       text not null,              -- en_progreso | completado | cerrado
  overdue     boolean not null default false,
  soon        boolean not null default false,
  primary key (bamboo_id, goal_id)
);

create table if not exists public.bamboo_training (
  bamboo_id   text not null references public.bamboo_employees(bamboo_id) on delete cascade,
  record_id   text not null,
  day         date,
  hours       numeric not null default 0,
  name        text not null,
  notes       text,
  links       text[] not null default '{}',
  primary key (bamboo_id, record_id)
);

create table if not exists public.bamboo_pto (
  bamboo_id   text primary key references public.bamboo_employees(bamboo_id) on delete cascade,
  kind        text,
  available   numeric not null default 0,
  used        numeric not null default 0,
  planned     numeric not null default 0,
  total       numeric not null default 0,
  unplanned   numeric not null default 0,
  ideal       numeric not null default 0,
  elapsed     numeric not null default 0,   -- fracción del año transcurrida
  level       text not null default '',     -- '' al ritmo | mid algo atrasado | low muy atrasado
  updated_at  timestamptz not null default now()
);

create table if not exists public.bamboo_sync_log (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  source        text,                       -- boton | cron
  message       text,
  stats         jsonb
);

create table if not exists public.bamboo_ai_cache (
  hash        text primary key,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Reglas (solo Gus)
-- ---------------------------------------------------------------------
create table if not exists public.rule_schedules (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null unique,         -- como figura en Bamboo
  days        int[] not null,               -- 0 = lunes ... 6 = domingo
  note        text,
  updated_at  timestamptz not null default now(),
  constraint rule_schedules_days_check check (days <@ array[0,1,2,3,4,5,6] and cardinality(days) > 0)
);

create table if not exists public.rule_holidays (
  id          uuid primary key default gen_random_uuid(),
  country     text not null,                -- minúsculas: bolivia, costa rica, united states...
  day         date not null,
  name        text not null,
  fraction    numeric not null default 1 check (fraction > 0 and fraction <= 1),
  unique (country, day)
);

create table if not exists public.rule_excluded (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null unique,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.rule_config (
  key    text primary key,
  value  jsonb not null
);

-- Clave interna para que la actualización automática (cada hora) pueda llamar a la función.
-- Nadie la ve desde la app: no tiene políticas, solo la usa el servidor.
create table if not exists public.bamboo_private (
  key    text primary key,
  value  text not null
);
alter table public.bamboo_private enable row level security;
revoke all on public.bamboo_private from anon, authenticated;
insert into public.bamboo_private (key, value)
values ('cron_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
create or replace function public.my_bamboo_id() returns text
language sql stable security definer set search_path = public as $$
  select p.bamboo_id from public.people p
  join public.profiles pr on pr.person_id = p.id
  where pr.id = auth.uid();
$$;

-- IDs de Bamboo que el usuario puede ver: él mismo y toda la gente que tiene debajo.
create or replace function public.bamboo_visible() returns text[]
language sql stable security definer set search_path = public as $$
  with recursive cadena as (
    select e.bamboo_id, 0 as nivel from public.bamboo_employees e where e.bamboo_id = public.my_bamboo_id()
    union
    select e.bamboo_id, c.nivel + 1 from public.bamboo_employees e
    join cadena c on e.supervisor_id = c.bamboo_id
    where c.nivel < 20
  )
  select coalesce(array_agg(distinct bamboo_id), '{}') from cadena;
$$;

create or replace function public.can_see_bamboo(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or b = any (public.bamboo_visible());
$$;

grant execute on function public.my_bamboo_id(), public.bamboo_visible(), public.can_see_bamboo(text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['bamboo_employees','bamboo_days','bamboo_goals','bamboo_training','bamboo_pto',
                           'bamboo_sync_log','bamboo_ai_cache','rule_schedules','rule_holidays','rule_excluded','rule_config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Datos de Bamboo: solo lectura desde la app (escribe la función con la llave de servicio)
revoke insert, update, delete on public.bamboo_employees, public.bamboo_days, public.bamboo_goals,
  public.bamboo_training, public.bamboo_pto, public.bamboo_sync_log, public.bamboo_ai_cache from authenticated;
grant select on public.bamboo_employees, public.bamboo_days, public.bamboo_goals,
  public.bamboo_training, public.bamboo_pto, public.bamboo_sync_log to authenticated;
revoke all on public.bamboo_ai_cache from authenticated;

do $$ declare t text; begin
  foreach t in array array['bamboo_employees','bamboo_days','bamboo_goals','bamboo_training','bamboo_pto'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin() or bamboo_id in (select unnest(public.bamboo_visible())))', t || '_select', t);
  end loop;
end $$;

drop policy if exists bamboo_sync_log_select on public.bamboo_sync_log;
create policy bamboo_sync_log_select on public.bamboo_sync_log for select to authenticated using (true);

-- Reglas: solo Gus las ve y las edita
grant select, insert, update, delete on public.rule_schedules, public.rule_holidays, public.rule_excluded, public.rule_config to authenticated;
do $$ declare t text; begin
  foreach t in array array['rule_schedules','rule_holidays','rule_excluded','rule_config'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Configuración inicial (no pisa lo que ya edites)
-- ---------------------------------------------------------------------
insert into public.rule_config (key, value) values
  ('main_projects', '["DDC"]'),
  ('hours_per_day', '8'),
  ('deadline_hour', '8'),
  ('timezone_offset', '-4')
on conflict (key) do nothing;

-- Horario de Erika y lista de excluidos: van en 06b_bamboo_datos.sql (no se publica en GitHub).

-- Feriados 2026 (calendario corporativo "Global Holidays 2026" + Paraguay)
insert into public.rule_holidays (country, day, name, fraction) values
  ('bolivia', '2026-01-01', 'Año Nuevo', 1),
  ('bolivia', '2026-01-02', 'Año Nuevo', 1),
  ('bolivia', '2026-02-16', 'Carnaval', 1),
  ('bolivia', '2026-02-17', 'Carnaval', 1),
  ('bolivia', '2026-04-03', 'Viernes Santo', 1),
  ('bolivia', '2026-05-01', 'Día del Trabajo', 1),
  ('bolivia', '2026-06-04', 'Corpus Christi', 1),
  ('bolivia', '2026-06-22', 'Año Nuevo Aymara Andino Amazónico', 1),
  ('bolivia', '2026-08-06', 'Día de la Independencia', 1),
  ('bolivia', '2026-11-02', 'Día de Todos los Difuntos', 1),
  ('bolivia', '2026-12-25', 'Navidad', 1),
  ('ecuador', '2026-01-01', 'Año Nuevo', 1),
  ('ecuador', '2026-02-16', 'Carnaval', 1),
  ('ecuador', '2026-02-17', 'Carnaval', 1),
  ('ecuador', '2026-04-03', 'Viernes Santo', 1),
  ('ecuador', '2026-05-01', 'Día del Trabajo', 1),
  ('ecuador', '2026-05-25', 'Batalla de Pichincha', 1),
  ('ecuador', '2026-08-10', 'Primer Grito de Independencia', 1),
  ('ecuador', '2026-10-09', 'Independencia de Guayaquil', 1),
  ('ecuador', '2026-11-02', 'Independencia de Cuenca', 1),
  ('ecuador', '2026-11-03', 'Día de los Difuntos', 1),
  ('ecuador', '2026-12-07', 'Fundacion Quito', 1),
  ('ecuador', '2026-12-25', 'Navidad', 1),
  ('peru', '2026-01-01', 'Año Nuevo', 1),
  ('peru', '2026-04-02', 'Jueves Santo', 1),
  ('peru', '2026-04-03', 'Viernes Santo', 1),
  ('peru', '2026-05-01', 'Día del Trabajo', 1),
  ('peru', '2026-06-29', 'San Pedro y San Pablo', 1),
  ('peru', '2026-07-29', 'Fiestas Patrias', 1),
  ('peru', '2026-08-31', 'Santa Rosa de Lima', 1),
  ('peru', '2026-10-08', 'Combate de Angamos', 1),
  ('peru', '2026-11-02', 'Día de Todos los Santos', 1),
  ('peru', '2026-12-08', 'Inmaculada Concepción', 1),
  ('peru', '2026-12-09', 'Batalla de Ayacucho', 1),
  ('peru', '2026-12-25', 'Navidad', 1),
  ('guatemala', '2026-01-01', 'Año Nuevo', 1),
  ('guatemala', '2026-04-02', 'Jueves Santo', 1),
  ('guatemala', '2026-04-03', 'Viernes Santo', 1),
  ('guatemala', '2026-05-01', 'Día del Trabajo', 1),
  ('guatemala', '2026-06-30', 'Día del Ejército', 1),
  ('guatemala', '2026-08-14', 'Día de la Asunción', 1),
  ('guatemala', '2026-09-15', 'Día de la Independencia', 1),
  ('guatemala', '2026-10-12', 'Dia de la Raza', 1),
  ('guatemala', '2026-10-20', 'Día de la Revolución', 1),
  ('guatemala', '2026-11-02', 'Día de Todos los Santos', 1),
  ('guatemala', '2026-12-24', 'Nochebuena', 0.5),
  ('guatemala', '2026-12-25', 'Navidad', 1),
  ('guatemala', '2026-12-31', 'Fin de Año', 0.5),
  ('dominican republic', '2026-01-01', 'Año Nuevo', 1),
  ('dominican republic', '2026-01-05', 'Día de los Santos Reyes', 1),
  ('dominican republic', '2026-01-21', 'Día de la Altagracia', 1),
  ('dominican republic', '2026-01-26', 'Día de Juan Pablo Duarte', 1),
  ('dominican republic', '2026-02-27', 'Día de la Independencia', 1),
  ('dominican republic', '2026-04-03', 'Viernes Santo', 1),
  ('dominican republic', '2026-05-04', 'Día del Trabajo', 1),
  ('dominican republic', '2026-06-04', 'Corpus Christi', 1),
  ('dominican republic', '2026-08-17', 'Día de la Restauración', 1),
  ('dominican republic', '2026-09-24', 'Día de las Mercedes', 1),
  ('dominican republic', '2026-11-09', 'Día de la Constitución', 1),
  ('dominican republic', '2026-12-25', 'Navidad', 1),
  ('united states', '2026-01-01', 'New Year''s Day', 1),
  ('united states', '2026-01-19', 'Martin Luther King, Jr. Day', 1),
  ('united states', '2026-02-16', 'Presidents'' Day', 1),
  ('united states', '2026-05-25', 'Memorial Day', 1),
  ('united states', '2026-06-19', 'Juneteenth National Independence Day', 1),
  ('united states', '2026-07-03', 'Independence Day', 1),
  ('united states', '2026-09-07', 'Labor Day', 1),
  ('united states', '2026-10-12', 'Columbus / Indigenous Peoples'' Day', 1),
  ('united states', '2026-11-11', 'Veterans Day', 1),
  ('united states', '2026-11-26', 'Thanksgiving Day', 1),
  ('united states', '2026-12-24', 'Christmas Eve', 1),
  ('united states', '2026-12-25', 'Christmas Day', 1),
  ('brazil', '2026-01-01', 'Confraternização Universal', 1),
  ('brazil', '2026-02-16', 'Carnaval', 1),
  ('brazil', '2026-02-17', 'Carnaval', 1),
  ('brazil', '2026-04-03', 'Paixão de Cristo', 1),
  ('brazil', '2026-04-21', 'Tiradentes', 1),
  ('brazil', '2026-05-01', 'Dia do Trabalho', 1),
  ('brazil', '2026-06-04', 'Corpus Christi', 1),
  ('brazil', '2026-09-07', 'Independência do Brasil', 1),
  ('brazil', '2026-10-12', 'Nossa Senhora Aparecida', 1),
  ('brazil', '2026-11-02', 'Finados', 1),
  ('brazil', '2026-11-16', 'Proclamação da República', 1),
  ('brazil', '2026-12-25', 'Natal', 1),
  ('nicaragua', '2026-01-01', 'Año Nuevo', 1),
  ('nicaragua', '2026-04-02', 'Jueves Santo', 1),
  ('nicaragua', '2026-04-03', 'Viernes Santo', 1),
  ('nicaragua', '2026-05-01', 'Día del Trabajo', 1),
  ('nicaragua', '2026-05-29', 'Día de la Madre', 1),
  ('nicaragua', '2026-07-20', 'Día de la Revolución Sandinista', 1),
  ('nicaragua', '2026-09-14', 'Batalla de San Jacinto', 1),
  ('nicaragua', '2026-09-15', 'Día de la Independencia', 1),
  ('nicaragua', '2026-11-02', 'Dia de todos los Santos', 1),
  ('nicaragua', '2026-12-08', 'Inmaculada Concepción', 1),
  ('nicaragua', '2026-12-25', 'Navidad', 1),
  ('nicaragua', '2026-12-31', 'Noche Vieja', 1),
  ('honduras', '2026-01-01', 'Año Nuevo', 1),
  ('honduras', '2026-04-02', 'Jueves Santo', 1),
  ('honduras', '2026-04-03', 'Viernes Santo', 1),
  ('honduras', '2026-04-14', 'Día de las Américas', 1),
  ('honduras', '2026-05-01', 'Día del Trabajo', 1),
  ('honduras', '2026-06-04', 'Corpus Christi', 1),
  ('honduras', '2026-09-15', 'Día de la Independencia', 1),
  ('honduras', '2026-10-07', 'Semana Morazánica (Día 1)', 1),
  ('honduras', '2026-10-08', 'Semana Morazánica (Día 2)', 1),
  ('honduras', '2026-10-09', 'Semana Morazánica (Día 3)', 1),
  ('honduras', '2026-12-25', 'Navidad', 1),
  ('honduras', '2026-12-31', 'Noche Vieja', 1),
  ('mexico', '2026-01-01', 'Año Nuevo', 1),
  ('mexico', '2026-02-02', 'Día de la Constitución', 1),
  ('mexico', '2026-03-16', 'Natalicio de Benito Juárez', 1),
  ('mexico', '2026-04-02', 'Jueves Santo', 1),
  ('mexico', '2026-04-03', 'Viernes Santo', 1),
  ('mexico', '2026-05-01', 'Día del Trabajo', 1),
  ('mexico', '2026-09-15', '15 de Septiembre es el grito de la independencia', 1),
  ('mexico', '2026-09-16', '16 de septiembre dia de la independecia', 1),
  ('mexico', '2026-11-02', 'Día de Muertos', 1),
  ('mexico', '2026-11-16', 'Día de la Revolución', 1),
  ('mexico', '2026-12-24', 'Noche Buena', 1),
  ('mexico', '2026-12-25', 'Navidad', 1),
  ('colombia', '2026-01-01', 'Año Nuevo', 1),
  ('colombia', '2026-01-12', 'Día de los Reyes Magos', 1),
  ('colombia', '2026-04-02', 'Jueves Santo', 1),
  ('colombia', '2026-04-03', 'Viernes Santo', 1),
  ('colombia', '2026-05-01', 'Día del Trabajo', 1),
  ('colombia', '2026-07-20', 'Día de la Independencia', 1),
  ('colombia', '2026-08-07', 'Batalla de Boyacá', 1),
  ('colombia', '2026-10-12', 'Día de la Raza', 1),
  ('colombia', '2026-11-02', 'Todos los Santos', 1),
  ('colombia', '2026-11-16', 'Independencia de Cartagena', 1),
  ('colombia', '2026-12-08', 'Inmaculada Concepción', 1),
  ('colombia', '2026-12-25', 'Navidad', 1),
  ('el salvador', '2026-01-01', 'Año Nuevo', 1),
  ('el salvador', '2026-04-02', 'Jueves Santo', 1),
  ('el salvador', '2026-04-03', 'Viernes Santo', 1),
  ('el salvador', '2026-05-01', 'Día del Trabajo', 1),
  ('el salvador', '2026-05-11', 'Día de la Madre', 1),
  ('el salvador', '2026-06-17', 'Día del Padre', 1),
  ('el salvador', '2026-08-05', 'Fiestas Patronales (San Salvador)', 1),
  ('el salvador', '2026-08-06', 'Fiestas Patronales (San Salvador)', 1),
  ('el salvador', '2026-09-15', 'Día de la Independencia', 1),
  ('el salvador', '2026-11-02', 'Día de los Difuntos', 1),
  ('el salvador', '2026-12-25', 'Navidad', 1),
  ('el salvador', '2026-12-31', 'Noche Vieja', 1),
  ('argentina', '2026-01-01', 'Año Nuevo', 1),
  ('argentina', '2026-02-16', 'Carnaval', 1),
  ('argentina', '2026-02-17', 'Carnaval', 1),
  ('argentina', '2026-04-02', 'Día del Veterano y de los Caídos en Malvinas', 1),
  ('argentina', '2026-04-03', 'Viernes Santo', 1),
  ('argentina', '2026-05-01', 'Día del Trabajador', 1),
  ('argentina', '2026-05-25', 'Día de la Revolución de Mayo', 1),
  ('argentina', '2026-06-19', 'Paso a la Inmortalidad de Belgrano (Bandera)', 1),
  ('argentina', '2026-07-09', 'Día de la Independencia', 1),
  ('argentina', '2026-10-12', 'Día del Respeto a la Diversidad Cultural', 1),
  ('argentina', '2026-12-08', 'Inmaculada Concepción de María', 1),
  ('argentina', '2026-12-25', 'Navidad', 1),
  ('costa rica', '2026-01-01', 'Año Nuevo', 1),
  ('costa rica', '2026-04-02', 'Jueves Santo', 1),
  ('costa rica', '2026-04-03', 'Viernes Santo', 1),
  ('costa rica', '2026-04-10', 'Día de Juan Santamaría', 1),
  ('costa rica', '2026-05-01', 'Día del Trabajo', 1),
  ('costa rica', '2026-07-24', 'Anexión del Partido de Nicoya', 1),
  ('costa rica', '2026-08-03', 'Virgen de los Ángeles', 1),
  ('costa rica', '2026-08-14', 'Día de la Madre', 1),
  ('costa rica', '2026-08-31', 'Día Internacional de las Personas Afrodescendientes', 1),
  ('costa rica', '2026-09-15', 'Día de la Independencia', 1),
  ('costa rica', '2026-12-01', 'Abolición del Ejército', 1),
  ('costa rica', '2026-12-25', 'Navidad', 1),
  ('puerto rico', '2026-01-01', 'Año Nuevo', 1),
  ('puerto rico', '2026-01-06', 'Día de Reyes', 1),
  ('puerto rico', '2026-01-19', 'Natalicio de Martin Luther King, Jr.', 1),
  ('puerto rico', '2026-04-03', 'Viernes Santo', 1),
  ('puerto rico', '2026-05-25', 'Día de la Recordación (Memorial Day)', 1),
  ('puerto rico', '2026-07-03', 'Día de la Independencia de EE.UU.', 1),
  ('puerto rico', '2026-07-24', 'Día de la Constitución de Puerto Rico', 1),
  ('puerto rico', '2026-09-07', 'Día del Trabajo (Labor Day)', 1),
  ('puerto rico', '2026-11-11', 'Día del Veterano', 1),
  ('puerto rico', '2026-11-26', 'Día de Acción de Gracias', 1),
  ('puerto rico', '2026-12-25', 'Navidad', 1),
  ('puerto rico', '2026-12-31', 'Noche Vieja', 1),
  ('chile', '2026-01-01', 'New Year', 1),
  ('chile', '2026-04-03', 'Good Friday', 1),
  ('chile', '2026-05-01', 'Labor Day', 1),
  ('chile', '2026-05-21', 'Day of Naval Glories', 1),
  ('chile', '2026-06-29', 'Saint Peter and Saint Paul.', 1),
  ('chile', '2026-07-16', 'Day of Our Lady of Mount Carmel', 1),
  ('chile', '2026-08-14', 'Assumption of the Virgin', 1),
  ('chile', '2026-09-18', 'National Independence', 1),
  ('chile', '2026-09-19', 'Army Day', 1),
  ('chile', '2026-11-02', 'All Saints', 1),
  ('chile', '2026-12-08', 'Immaculate Conception', 1),
  ('chile', '2026-12-25', 'Christmas Day', 1),
  ('uruguay', '2026-01-01', 'Año Nuevo', 1),
  ('uruguay', '2026-01-06', 'Día de los Reyes', 1),
  ('uruguay', '2026-02-16', 'Carnaval', 1),
  ('uruguay', '2026-02-17', 'Carnaval', 1),
  ('uruguay', '2026-04-02', 'Jueves Santo', 1),
  ('uruguay', '2026-04-03', 'Viernes Santo', 1),
  ('uruguay', '2026-04-19', 'Desembarco de los 33 Orientales', 1),
  ('uruguay', '2026-05-01', 'Día del Trabajador', 1),
  ('uruguay', '2026-07-18', 'Jura de la Constitución', 1),
  ('uruguay', '2026-08-25', 'Declaratoria de la Independencia', 1),
  ('uruguay', '2026-11-02', 'Día de los Difuntos', 1),
  ('uruguay', '2026-12-25', 'Navidad (Día de la Familia)', 1),
  ('paraguay', '2026-12-08', 'Día de la Virgen de Caacupé', 1),
  ('paraguay', '2026-12-25', 'Navidad', 1)
on conflict (country, day) do nothing;

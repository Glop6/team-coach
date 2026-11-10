-- =====================================================================
--  TEAM COACH · Cambio 39: casos y horas con una sola regla (producción, soporte, reworks)
--  Va DESPUÉS de 26_perf_deshacer_seguro.sql y ANTES de publicar el código de este cambio.
--  Esta es la ÚNICA fuente de la regla. Rendimiento (resumen_casos) y el dashboard leen las columnas
--  que se calculan aquí; ninguno de los dos decide por su cuenta qué es caso ni qué horas suman.
--
--  1. perf.records.categoria (calculada):
--       'rework'     = proyecto Reworks, Rework de Site Services (SS RW) y Re-check de Landing Pages
--       'soporte'    = Support de Site Services (SS Support)
--       'produccion' = todo lo demás
--     Solo 'produccion' cuenta como caso completado. Las horas de las tres categorías suman siempre.
--  2. perf.records.ticket (calculada): número de caso de Site Services sin ceros a la izquierda
--     (08192855 y 8192855 son el mismo ticket). Sirve para unir el soporte con su caso original.
--  3. perf.records.horas_repetidas_de: el mismo rework registrado dos veces, en Other Projects (archivo
--     genérico) y en el export de WOMS Reworks. La fila de Other Projects apunta a la de WOMS y sus horas
--     no se suman (se cuentan una sola vez). Pareja = misma persona, mismo tipo, mismo LOE, y
--       · mismo número D- con hasta 7 días de diferencia, o
--       · hasta 2 días de diferencia, si alguna de las dos no trae número D- (si las dos lo traen, debe ser el mismo).
--     Cada fila tiene como máximo una pareja (primero las de mismo D-, luego las más cercanas en fecha).
--  4. perf.records.aviso (calidad de datos; las horas siguen sumando hasta que se corrija):
--       'rework_sin_numero'  rework sin número de caso (ni D-, ni ticket, ni el de su pareja)
--       'soporte_sin_ticket' SS Support sin ticket numérico
--       'soporte_del_dueno'  SS Support de alguien que también es el dueño de ese ticket en Site Services
--  3 y 4 se recalculan solos después de cada carga, cambio o "Deshacer" (trigger por sentencia).
--  5. resumen_casos y resumen_horario usan estas columnas. resumen_casos agrega las horas por categoría.
--  Re-ejecutable.
-- =====================================================================

-- ---------- reglas por fila (inmutables: se usan en columnas calculadas) ----------
create or replace function perf.categoria(p_project text, p_work_type text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_project = 'CodeRoad Internal - Reworks'
      or (p_project = 'Site Services' and p_work_type = 'Rework')
      or p_work_type = 'Recheck' then 'rework'
    when p_project = 'Site Services' and p_work_type = 'Support' then 'soporte'
    else 'produccion' end
$$;

create or replace function perf.ticket(p_project text, p_case_id text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when p_project = 'Site Services' and btrim(p_case_id) ~ '^\d+$'
              then coalesce(nullif(ltrim(btrim(p_case_id), '0'), ''), '0') end
$$;

-- Número de deliverable de WOMS ("D-157089", "RW1-D-157089", "rework-D-157089", "D 157089") → 'D-157089'
create or replace function perf.numero_d(p_texto text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select 'D-' || substring(upper(coalesce(p_texto, '')) from '(?:^|[^A-Z])D-? ?(\d{5,7})')
$$;

alter table perf.records add column if not exists categoria text
  generated always as (perf.categoria(project, work_type)) stored;
alter table perf.records add column if not exists ticket text
  generated always as (perf.ticket(project, case_id)) stored;
-- Sin llave foránea a propósito: "Deshacer" puede restaurar una fila antes que su pareja; el recálculo la corrige.
alter table perf.records add column if not exists horas_repetidas_de bigint;
alter table perf.records add column if not exists aviso text;
create index if not exists records_categoria_idx on perf.records (categoria) where categoria <> 'produccion';
create index if not exists records_ticket_idx on perf.records (ticket) where ticket is not null;

-- ---------- recálculo de reworks repetidos y avisos ----------
create or replace function perf.recalcular_horas() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  par record;
  usados_g bigint[] := '{}';
  usados_w bigint[] := '{}';
  n_rep integer; n_av integer;
begin
  -- 1) Parejas Other Projects ↔ WOMS Reworks (una a una)
  for par in
    with rw as (
      select r.id, r.person_id, r.work_type, r.event_date, coalesce(r.loe_manual, r.loe) loe,
             r.extra->>'sourceType' st, perf.numero_d(coalesce(r.case_id, '') || ' ' || coalesce(r.title, '')) d
        from perf.records r
       where r.project = 'CodeRoad Internal - Reworks' and r.person_id is not null and r.event_date is not null
    )
    select g.id gid, w.id wid
      from rw g join rw w on w.person_id = g.person_id and w.work_type is not distinct from g.work_type and w.loe = g.loe
     where g.st = 'generic_case' and w.st = 'reworks' and g.loe > 0
       and (   (g.d = w.d and abs(extract(epoch from g.event_date - w.event_date)) <= 7 * 86400)
            or ((g.d is null or w.d is null) and abs(extract(epoch from g.event_date - w.event_date)) <= 2 * 86400))
     order by (g.d = w.d) desc nulls last, abs(extract(epoch from g.event_date - w.event_date)), g.id, w.id
  loop
    if not (par.gid = any(usados_g) or par.wid = any(usados_w)) then
      usados_g := usados_g || par.gid;
      usados_w := usados_w || par.wid;
    end if;
  end loop;

  update perf.records r set horas_repetidas_de = m.wid
    from unnest(usados_g, usados_w) as m(gid, wid)
   where r.id = m.gid and r.horas_repetidas_de is distinct from m.wid;
  update perf.records r set horas_repetidas_de = null
   where r.horas_repetidas_de is not null and not (r.id = any(usados_g));
  select count(*) into n_rep from perf.records where horas_repetidas_de is not null;

  -- 2) Avisos de calidad de datos
  with a as (
    select r.id,
      case
        when r.horas_repetidas_de is not null then null
        when r.categoria = 'rework'
             and perf.numero_d(coalesce(r.case_id, '') || ' ' || coalesce(r.title, '')) is null
             and r.ticket is null
             and not (r.work_type = 'Recheck' and nullif(btrim(r.case_id), '') is not null)
             and not exists (select 1 from perf.records g
                              where g.horas_repetidas_de = r.id
                                and perf.numero_d(coalesce(g.case_id, '') || ' ' || coalesce(g.title, '')) is not null)
          then 'rework_sin_numero'
        when r.categoria = 'soporte' and r.ticket is null then 'soporte_sin_ticket'
        when r.categoria = 'soporte' and r.person_id is not null and exists (
               select 1 from perf.records s
                where s.ticket = r.ticket and s.person_id = r.person_id and s.categoria = 'produccion')
          then 'soporte_del_dueno'
      end aviso
    from perf.records r
    where r.categoria <> 'produccion' or r.aviso is not null
  )
  update perf.records r set aviso = a.aviso from a where r.id = a.id and r.aviso is distinct from a.aviso;
  select count(*) into n_av from perf.records where aviso is not null;
  return jsonb_build_object('reworks_repetidos', n_rep, 'avisos', n_av);
end $$;
revoke all on function perf.recalcular_horas() from public, anon, authenticated;
grant execute on function perf.recalcular_horas() to service_role;

-- Después de cada sentencia que agrega, borra o cambia datos que afectan la regla.
-- El propio recálculo solo toca horas_repetidas_de y aviso, así que no se vuelve a disparar.
create or replace function perf.tg_recalcular_horas() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform perf.recalcular_horas();
  return null;
end $$;
revoke all on function perf.tg_recalcular_horas() from public, anon, authenticated;

drop trigger if exists records_recalcular_horas_ins on perf.records;
drop trigger if exists records_recalcular_horas_upd on perf.records;
drop trigger if exists records_recalcular_horas_del on perf.records;
create trigger records_recalcular_horas_ins after insert on perf.records
  for each statement execute function perf.tg_recalcular_horas();
create trigger records_recalcular_horas_upd
  after update of project, work_type, case_id, title, event_date, loe, loe_manual, person_id, extra on perf.records
  for each statement execute function perf.tg_recalcular_horas();
create trigger records_recalcular_horas_del after delete on perf.records
  for each statement execute function perf.tg_recalcular_horas();

select perf.recalcular_horas();

-- ---------- resúmenes de Rendimiento con la regla nueva ----------
-- Cambia la lista de columnas que devuelve: hay que borrarla y crearla de nuevo.
-- casos = solo producción. loe_min = horas totales sin repetidas (minutos). Más el desglose por categoría.
drop function if exists perf.resumen_casos(date);
create function perf.resumen_casos(p_desde date)
returns table (person_id uuid, mes text, proyecto text, casos integer, filas integer, loe_min numeric,
               loe_produccion numeric, loe_soporte numeric, loe_rework numeric)
language sql stable security invoker set search_path = '' as $$
  with r as (
    select r.person_id, r.project, r.categoria,
           to_char(r.event_date at time zone 'America/La_Paz', 'YYYY-MM') mes,
           case when r.horas_repetidas_de is null then coalesce(r.loe_manual, r.loe) end loe
    from perf.records r
    where r.person_id is not null and r.event_date is not null
      and r.event_date >= (p_desde::timestamp at time zone 'America/La_Paz')
      -- isCounted sin filtro de estado: CW solo "Completed"; Site Services con estado, solo "Closed…"
      and case when r.extra->>'sourceType' = 'cw' then coalesce(r.extra->>'status', '') = 'Completed'
               when r.extra->>'sourceType' = 'site_services' and coalesce(r.extra->>'status', '') <> '' then r.extra->>'status' like 'Closed%'
               else true end
  )
  select person_id, mes, project,
         count(*) filter (where categoria = 'produccion')::int, count(*)::int,
         coalesce(sum(loe), 0),
         coalesce(sum(loe) filter (where categoria = 'produccion'), 0),
         coalesce(sum(loe) filter (where categoria = 'soporte'), 0),
         coalesce(sum(loe) filter (where categoria = 'rework'), 0)
  from r group by 1, 2, 3
$$;

create or replace function perf.resumen_horario(p_desde date)
returns table (person_id uuid, hora integer, dia integer, casos integer)
language sql stable security invoker set search_path = '' as $$
  select r.person_id,
         extract(hour from r.event_date at time zone 'America/La_Paz')::int,
         extract(isodow from r.event_date at time zone 'America/La_Paz')::int,
         count(*)::int
  from perf.records r
  where r.person_id is not null and r.event_date is not null
    and r.event_date >= (p_desde::timestamp at time zone 'America/La_Paz')
    and case when r.extra->>'sourceType' = 'cw' then coalesce(r.extra->>'status', '') = 'Completed'
             when r.extra->>'sourceType' = 'site_services' and coalesce(r.extra->>'status', '') <> '' then r.extra->>'status' like 'Closed%'
             else true end
    and r.categoria = 'produccion'
  group by 1, 2, 3
$$;

revoke all on function perf.resumen_casos(date), perf.resumen_horario(date) from public, anon;
grant execute on function perf.resumen_casos(date), perf.resumen_horario(date) to authenticated, service_role;

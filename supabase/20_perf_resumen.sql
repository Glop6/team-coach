-- =====================================================================
--  TEAM COACH · Cambio 28: resúmenes de rendimiento y ajustes solo para el admin
--  Va DESPUÉS de 19_perf_dashboard.sql.
--  1) Resúmenes por persona y mes, calculados en la base, para la sección Rendimiento.
--     Así el navegador no descarga los casos uno por uno. Son SECURITY INVOKER:
--     cada uno ve solo lo que sus permisos (RLS de perf) le dejan ver.
--     Las reglas son las mismas de src/perf/motor.js (isCounted, countsAsCase, LOE manual).
--     Si cambia una, cambia la otra.
--  2) Las claves de perf.app_settings que empiezan con "owner_" solo las lee el admin
--     (por ejemplo, las fechas de ingreso). El resto lo siguen leyendo líderes y admin.
--  Re-ejecutable.
-- =====================================================================

-- Mes y hora en horario de Bolivia (como los ve el equipo)
create or replace function perf.resumen_casos(p_desde date)
returns table (person_id uuid, mes text, proyecto text, casos integer, filas integer, loe_min numeric)
language sql stable security invoker set search_path = '' as $$
  with r as (
    select r.person_id, r.project,
           to_char(r.event_date at time zone 'America/La_Paz', 'YYYY-MM') mes,
           coalesce(r.loe_manual, r.loe) loe,
           -- countsAsCase sin filtros: el trabajo de seguimiento no cuenta como caso nuevo
           not ((r.project = 'Site Services' and r.work_type in ('Support', 'Rework'))
                or r.work_type = 'Recheck'
                or r.project = 'CodeRoad Internal - Reworks') es_caso
    from perf.records r
    where r.person_id is not null and r.event_date is not null
      and r.event_date >= (p_desde::timestamp at time zone 'America/La_Paz')
      -- isCounted sin filtro de estado: CW solo "Completed"; Site Services con estado, solo "Closed…"
      and case when r.extra->>'sourceType' = 'cw' then coalesce(r.extra->>'status', '') = 'Completed'
               when r.extra->>'sourceType' = 'site_services' and coalesce(r.extra->>'status', '') <> '' then r.extra->>'status' like 'Closed%'
               else true end
  )
  select person_id, mes, project, count(*) filter (where es_caso)::int, count(*)::int, coalesce(sum(loe), 0)
  from r group by 1, 2, 3
$$;

-- Cuándo trabaja cada persona: casos por hora del día y día de la semana (1 = lunes)
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
    and not ((r.project = 'Site Services' and r.work_type in ('Support', 'Rework'))
             or r.work_type = 'Recheck'
             or r.project = 'CodeRoad Internal - Reworks')
  group by 1, 2, 3
$$;

-- QA por persona y mes. Error real = Failed/Critical que no se marcó NA (isRealError)
create or replace function perf.resumen_qa(p_desde date)
returns table (person_id uuid, mes text, total integer, errores integer, en_progreso integer)
language sql stable security invoker set search_path = '' as $$
  select q.person_id,
         to_char(q.date_completed at time zone 'America/La_Paz', 'YYYY-MM'),
         count(*)::int,
         count(*) filter (where q.qa_status in ('Failed', 'Critical') and not coalesce(q.is_na, false))::int,
         count(*) filter (where q.qa_status = 'In progress')::int
  from perf.qa_records q
  where q.person_id is not null and q.date_completed is not null
    and q.date_completed >= (p_desde::timestamp at time zone 'America/La_Paz')
  group by 1, 2
$$;

revoke all on function perf.resumen_casos(date), perf.resumen_horario(date), perf.resumen_qa(date) from public, anon;
grant execute on function perf.resumen_casos(date), perf.resumen_horario(date), perf.resumen_qa(date) to authenticated, service_role;

-- Ajustes: las claves "owner_…" solo las lee el admin
drop policy if exists settings_select on perf.app_settings;
create policy settings_select on perf.app_settings for select to authenticated
  using ((select perf.is_owner()) or ((select perf.is_lead_or_owner()) and key not like 'owner\_%'));

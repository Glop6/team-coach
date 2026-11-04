-- =====================================================================
--  TEAM COACH · Cambio 35: Deliverables Used de Copywriters por persona y mes
--  Va DESPUÉS de 23_perf_qa_reglas.sql.
--  Por persona y mes: la suma de "Deliverables Used" (extra->deliverablesUsed), los días con registros y las
--  filas. El promedio diario = suma ÷ días con registros, igual que "Avg / day" del dashboard (Grupos →
--  Copywriters). Solo filas del proyecto Copywriting que traen el dato (las subidas desde octubre de 2026) y
--  con la regla isCounted de motor.js: de CW, solo las "Completed".
--  SECURITY INVOKER: cada uno ve solo lo que sus permisos (RLS de perf) le dejan ver.
--  Re-ejecutable.
-- =====================================================================

create or replace function perf.resumen_entregables(p_desde date)
returns table (person_id uuid, mes text, entregables numeric, dias integer, filas integer)
language sql stable security invoker set search_path = '' as $$
  select r.person_id, to_char(k.dia, 'YYYY-MM'), sum(k.v), count(distinct k.dia)::int, count(*)::int
  from perf.records r
  cross join lateral (select (r.event_date at time zone 'America/La_Paz')::date dia, (r.extra->>'deliverablesUsed')::numeric v) k
  where r.person_id is not null and r.event_date is not null
    and r.event_date >= (p_desde::timestamp at time zone 'America/La_Paz')
    and r.project = 'CodeRoad Internal - Copywriting'
    and jsonb_typeof(r.extra->'deliverablesUsed') = 'number'
    and case when r.extra->>'sourceType' = 'cw' then coalesce(r.extra->>'status', '') = 'Completed' else true end
  group by 1, 2
$$;

revoke all on function perf.resumen_entregables(date) from public, anon;
grant execute on function perf.resumen_entregables(date) to authenticated, service_role;

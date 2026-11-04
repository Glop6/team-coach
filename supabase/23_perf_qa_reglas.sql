-- =====================================================================
--  TEAM COACH · Cambio 34: reglas de QA (bugs, oportunidades y sin falla)
--  Va DESPUÉS de 22_perf_config_lider.sql.
--  - NA: la respuesta (fix_comment) empieza con NA / N/A / N.A (también tras "1.") y no dice en ninguna parte
--    que algo se corrigió (fix, fixed...). Mixta (NA y Fixed) = bug. Hasta ahora solo contaba un "NA" exacto.
--  - Bug: Failed / Critical sin NA. Oportunidad: Opportunity / Observed sin NA. Sin falla: Passed o cualquier
--    otro con NA. En curso (In progress) no entra en el cálculo.
--  Las mismas reglas, en JS, están en src/perf/qa.js: si cambias una, cambia la otra.
--  1) perf.es_na() y perf.clase_qa()  2) recalcula is_na en las filas cargadas (solo las que cambian; el
--  trigger qa_touch les pone updated_at, así los dashboards abiertos las vuelven a bajar)  3) resumen_qa con
--  el desglose para Rendimiento (cambia las columnas que devuelve: se borra y se vuelve a crear).
--  Re-ejecutable. Todo en una transacción.
-- =====================================================================
begin;

create or replace function perf.es_na(t text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(t, '') ~* '^\s*([0-9]+\s*[.)-]?\s*)?n\s*[/.]?\s*a([^a-z0-9_]|$)'
     and not coalesce(t, '') ~* '(^|[^a-z0-9_])fix(ed|es|ing)?([^a-z0-9_]|$)'
$$;

create or replace function perf.clase_qa(status text, na boolean) returns text
language sql immutable set search_path = '' as $$
  select case
    when status = 'Passed' then 'sin_falla'
    when status in ('Failed', 'Critical') then case when na then 'sin_falla' else 'bug' end
    when status in ('Opportunity', 'Observed') then case when na then 'sin_falla' else 'oportunidad' end
    when status = 'In progress' then 'en_curso'
  end
$$;

update perf.qa_records set is_na = perf.es_na(fix_comment)
where is_na is distinct from perf.es_na(fix_comment);

-- QA por persona y mes. errores = bugs (se mantiene el nombre); el resto, para el desglose
drop function if exists perf.resumen_qa(date);
create function perf.resumen_qa(p_desde date)
returns table (person_id uuid, mes text, total integer, errores integer, en_progreso integer,
               criticos integer, oportunidades integer, observados integer, sin_falla integer, na integer)
language sql stable security invoker set search_path = '' as $$
  select q.person_id,
         to_char(q.date_completed at time zone 'America/La_Paz', 'YYYY-MM'),
         count(*)::int,
         count(*) filter (where c = 'bug')::int,
         count(*) filter (where c = 'en_curso')::int,
         count(*) filter (where c = 'bug' and q.qa_status = 'Critical')::int,
         count(*) filter (where c = 'oportunidad')::int,
         count(*) filter (where c = 'oportunidad' and q.qa_status = 'Observed')::int,
         count(*) filter (where c = 'sin_falla')::int,
         count(*) filter (where c = 'sin_falla' and q.qa_status <> 'Passed')::int
  from perf.qa_records q
  cross join lateral (select perf.clase_qa(q.qa_status, coalesce(q.is_na, false)) c) k
  where q.person_id is not null and q.date_completed is not null
    and q.date_completed >= (p_desde::timestamp at time zone 'America/La_Paz')
  group by 1, 2
$$;

revoke all on function perf.es_na(text), perf.clase_qa(text, boolean), perf.resumen_qa(date) from public, anon;
grant execute on function perf.es_na(text), perf.clase_qa(text, boolean), perf.resumen_qa(date) to authenticated, service_role;

-- Los dashboards abiertos vuelven a descargar todo con la regla nueva
update perf.data_epoch set epoch = epoch + 1 where id = 1;

commit;

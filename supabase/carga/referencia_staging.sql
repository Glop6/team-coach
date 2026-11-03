-- Números de referencia de MS Dash sacados de perf_staging (la copia exacta del respaldo), antes de perf_carga.sql
-- o después, mientras exista el staging. Mismas consultas que referencia_perf.sql, a /tmp/ref_*.csv. Solo lectura.
begin read only;

\copy (select to_char(date_trunc('month', r.event_date), 'YYYY-MM') mes, coalesce(p.full_name, '(sin persona) ' || coalesce(r.owner_raw, '')) persona, count(distinct r.case_id) casos, count(*) registros, round(sum(coalesce(r.loe_manual, r.loe)), 2) loe from perf_staging.records r left join perf_staging.people p on p.id = r.person_id group by 1, 2 order by 1, 2) to '/tmp/ref_casos_horas_persona_mes.csv' csv header

\copy (select to_char(date_trunc('month', q.date_completed), 'YYYY-MM') mes, coalesce(p.full_name, '(sin persona) ' || coalesce(q.owner_raw, '')) persona, count(*) qa_registros, count(*) filter (where q.is_na) qa_na, count(distinct q.case_id) qa_casos from perf_staging.qa_records q left join perf_staging.people p on p.id = q.person_id group by 1, 2 order by 1, 2) to '/tmp/ref_qa_persona_mes.csv' csv header

\copy (select coalesce(a.mes, b.mes) mes, a.casos, a.registros, a.loe, b.qa_registros from (select to_char(date_trunc('month', event_date), 'YYYY-MM') mes, count(distinct case_id) casos, count(*) registros, round(sum(coalesce(loe_manual, loe)), 2) loe from perf_staging.records group by 1) a full join (select to_char(date_trunc('month', date_completed), 'YYYY-MM') mes, count(*) qa_registros from perf_staging.qa_records group by 1) b on a.mes = b.mes order by 1) to '/tmp/ref_totales_mes.csv' csv header

\copy (select 'people' tabla, count(*) filas from perf_staging.people union all select 'records', count(*) from perf_staging.records union all select 'qa_records', count(*) from perf_staging.qa_records union all select 'upload_batches', count(*) from perf_staging.upload_batches union all select 'qa_categories', count(*) from perf_staging.qa_categories union all select 'app_settings', count(*) from perf_staging.app_settings union all select 'ai_usage', count(*) from perf_staging.ai_usage union all select 'records_con_loe_manual', count(*) from perf_staging.records where loe_manual is not null) to '/tmp/ref_conteos_tablas.csv' csv header

commit;

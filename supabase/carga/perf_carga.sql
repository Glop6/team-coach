-- Carga de MS Dash (perf_staging) → perf, con vínculos a Team Coach.
-- Requiere: 19_perf_dashboard.sql aplicado y perf_staging cargado desde el respaldo de MS Dash (ver LEEME.md).
--
-- ⚠️  ADVERTENCIA: este script VACÍA perf entero (casos, QA, cargas, ajustes, uso de IA) y lo recarga
--     desde perf_staging. Es solo para la migración inicial. NUNCA se corre después del lanzamiento:
--     borraría todo lo que se haya subido o ajustado en Team Coach desde entonces.
--     No toca public.* ni MS Dash.
\set ON_ERROR_STOP on
begin;

truncate perf.records, perf.qa_records, perf.upload_batches, perf.qa_categories,
         perf.app_settings, perf.ai_usage, perf.uploaders, perf.people restart identity cascade;

-- 1) Personas del dashboard, con su ficha de Team Coach (por correo). El owner → login admin de Team Coach.
insert into perf.people (id, full_name, email, active, name_keys, tc_person_id, tc_user_id, created_at)
select s.id, s.full_name, s.email, s.active, s.name_keys,
       tp.id,
       case when ur.role = 'owner' then (select pr.id from public.profiles pr where pr.role = 'admin' order by pr.created_at limit 1) end,
       s.created_at
from perf_staging.people s
left join perf_staging.user_roles ur on ur.person_id = s.id
left join public.people tp on lower(tp.email) = lower(s.email) and ur.role <> 'owner';

-- 2) Ex-miembros: nombres del Excel sin persona (salvo "Level N - ..."), unificando nombre y correo.
create temp table ex_raw on commit drop as
with raw as (
  select trim(owner_raw) raw from perf_staging.records    where person_id is null and coalesce(trim(owner_raw), '') <> ''
  union
  select trim(owner_raw)     from perf_staging.qa_records where person_id is null and coalesce(trim(owner_raw), '') <> ''
)
select raw,
       case when raw like '%@%'
            then initcap(replace(regexp_replace(split_part(lower(raw), '@', 1), '[0-9]+$', ''), '.', ' '))
            else initcap(lower(raw)) end as persona
from raw
where raw !~* '^level [0-9]+ - ';

insert into perf.people (full_name, email, active, name_keys)
select persona,
       min(lower(raw)) filter (where raw like '%@%'),
       false,
       array_agg(distinct lower(raw) order by lower(raw))
from ex_raw group by persona;

create temp table ex_map on commit drop as
select e.raw, p.id as person_id
from ex_raw e join perf.people p on p.full_name = e.persona and not p.active and p.tc_person_id is null;

-- 3) Quién puede subir datos (además del admin): los que hoy tienen can_upload y no son owner.
insert into perf.uploaders (user_id)
select pr.id
from perf_staging.user_roles ur
join perf.people p on p.id = ur.person_id
join public.profiles pr on pr.person_id = p.tc_person_id
where ur.can_upload and ur.role <> 'owner';

-- 4) Datos (mismos id que en MS Dash)
insert into perf.upload_batches (id, uploaded_by, file_name, file_type, period, row_count, created_at, batch_id, sheet_name, excluded)
select id, uploaded_by, file_name, file_type, period, row_count, created_at, batch_id, sheet_name, excluded
from perf_staging.upload_batches;

insert into perf.records (id, batch_id, person_id, owner_raw, project, work_type, case_id, title, event_date, loe, system,
                          source_file, extra, dedup_key, import_batch_id, updated_at, loe_manual, loe_ok, manual_by, manual_at)
select r.id, r.batch_id, coalesce(r.person_id, m.person_id), r.owner_raw, r.project, r.work_type, r.case_id, r.title, r.event_date,
       r.loe, r.system, r.source_file, r.extra, r.dedup_key, r.import_batch_id, r.updated_at, r.loe_manual, r.loe_ok, r.manual_by, r.manual_at
from perf_staging.records r
left join ex_map m on r.person_id is null and m.raw = trim(r.owner_raw);

insert into perf.qa_records (id, batch_id, person_id, owner_raw, case_id, qa_status, reviewer, date_completed, secondary_date,
                             fix_comment, follow_up_level, is_na, extra, dedup_key, import_batch_id, updated_at)
select q.id, q.batch_id, coalesce(q.person_id, m.person_id), q.owner_raw, q.case_id, q.qa_status, q.reviewer, q.date_completed,
       q.secondary_date, q.fix_comment, q.follow_up_level, q.is_na, q.extra, q.dedup_key, q.import_batch_id, q.updated_at
from perf_staging.qa_records q
left join ex_map m on q.person_id is null and m.raw = trim(q.owner_raw);

insert into perf.qa_categories (dedup_key, category, generated_at, generated_by)
select dedup_key, category, generated_at, generated_by from perf_staging.qa_categories;

insert into perf.app_settings (key, value, updated_by, updated_at)
select key, value, updated_by, updated_at from perf_staging.app_settings;

insert into perf.ai_usage (id, person_id, feature, model, input_tokens, output_tokens, created_at)
select id, person_id, feature, model, input_tokens, output_tokens, created_at from perf_staging.ai_usage;

update perf.data_epoch set epoch = (select epoch from perf_staging.data_epoch where id = 1) + 1 where id = 1;

select setval(pg_get_serial_sequence('perf.upload_batches', 'id'), greatest((select max(id) from perf.upload_batches), 1));
select setval(pg_get_serial_sequence('perf.records', 'id'),        greatest((select max(id) from perf.records), 1));
select setval(pg_get_serial_sequence('perf.qa_records', 'id'),     greatest((select max(id) from perf.qa_records), 1));
select setval(pg_get_serial_sequence('perf.ai_usage', 'id'),       greatest((select max(id) from perf.ai_usage), 1));

commit;

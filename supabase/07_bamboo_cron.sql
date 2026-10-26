-- =====================================================================
--  TEAM COACH · Cambio 13b: actualización automática desde Bamboo
--  Corre DESPUÉS de 06_bamboo.sql y de publicar la función "bamboo-sync".
--  Lunes a viernes, cada hora de 8:05 a 19:05 (hora de Bolivia).
--  Se puede correr más de una vez (reemplaza el horario anterior).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  perform cron.unschedule('bamboo-sync');
exception when others then null;
end $$;

select cron.schedule(
  'bamboo-sync',
  '5 12-23 * * 1-5',          -- en UTC: 12:05 a 23:05 = 8:05 a 19:05 en Bolivia
  $$
  select net.http_post(
    url     := 'https://sumxpfedmslrjalhebcd.supabase.co/functions/v1/bamboo-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.bamboo_private where key = 'cron_secret')
    ),
    body    := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 140000
  );
  $$
);

-- Para revisar: select * from cron.job;  ·  select * from cron.job_run_details order by start_time desc limit 5;

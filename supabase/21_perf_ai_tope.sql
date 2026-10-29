-- =====================================================================
--  TEAM COACH · Cambio 29: tope de costo de la IA del Performance Dashboard
--  Va DESPUÉS de 20_perf_resumen.sql.
--  La Edge Function ai-proxy consulta cuánto se gastó (hoy y en el mes, en total y por persona)
--  antes de llamar a Anthropic. Los días y meses son en horario de Bolivia.
--  Los topes se configuran en perf.app_settings, clave "ai_limits" (ver el insert de abajo).
--  Re-ejecutable.
-- =====================================================================

create or replace function perf.ai_gasto(p_person uuid)
returns table (hoy_total numeric, mes_total numeric, hoy_persona numeric, mes_persona numeric, llamadas_hoy_persona integer)
language sql stable security definer set search_path = '' as $$
  with b as (
    select date_trunc('day', now() at time zone 'America/La_Paz') at time zone 'America/La_Paz' dia,
           date_trunc('month', now() at time zone 'America/La_Paz') at time zone 'America/La_Paz' mes
  )
  select coalesce(sum(u.cost_usd) filter (where u.created_at >= b.dia), 0),
         coalesce(sum(u.cost_usd), 0),
         coalesce(sum(u.cost_usd) filter (where u.created_at >= b.dia and u.person_id = p_person), 0),
         coalesce(sum(u.cost_usd) filter (where u.person_id = p_person), 0),
         (count(*) filter (where u.created_at >= b.dia and u.person_id = p_person))::int
  from b left join perf.ai_usage u on u.created_at >= b.mes
  group by b.dia
$$;

-- Solo el servidor (la Edge Function con service_role) lo consulta
revoke all on function perf.ai_gasto(uuid) from public, anon, authenticated;
grant execute on function perf.ai_gasto(uuid) to service_role;

-- Topes por defecto, en dólares. El admin los puede cambiar con un update de esta fila.
-- El total diario y el mensual aplican a todos (también al admin); los topes por persona, a todos menos al admin.
insert into perf.app_settings (key, value) values ('ai_limits', jsonb_build_object(
  'dia_total_usd', 5,
  'mes_total_usd', 30,
  'dia_persona_usd', 1,
  'mes_persona_usd', 10,
  'llamadas_dia_persona', 150
)) on conflict (key) do nothing;

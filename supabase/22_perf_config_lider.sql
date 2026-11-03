-- =====================================================================
--  TEAM COACH · Cambio 32: un líder recibe solo la parte de team_config de su gente
--  Va DESPUÉS de 21_perf_ai_tope.sql.
--  perf.app_settings.team_config tiene los nombres de todo el equipo (grupos, asignaciones, alias,
--  ex-miembros...). Hasta ahora cualquier líder la leía completa por la API.
--  - El admin y quien puede subir datos (ya lee todos los casos) la siguen leyendo completa.
--  - Un líder sin permiso de subida ya no la lee de la tabla: perf.team_config_mio() le devuelve
--    solo las entradas de las personas que puede ver (perf.visible_person_ids()).
--  - Una persona del equipo (member) no recibe nada, igual que antes.
--  Re-ejecutable.
-- =====================================================================

-- Nombre comparable: minúsculas y sin tildes (los nombres de team_config van en minúsculas)
create or replace function perf.nombre_clave(t text) returns text
language sql immutable set search_path = '' as $$
  select translate(lower(trim(t)), 'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc')
$$;

create or replace function perf.team_config_mio() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb; n text[]; r jsonb := '{}'; k text; v jsonb;
begin
  if not perf.is_lead_or_owner() then return null; end if;
  select s.value into c from perf.app_settings s where s.key = 'team_config';
  if c is null or perf.can_upload() then return c; end if;

  select coalesce(array_agg(perf.nombre_clave(x.full_name)), '{}') into n
  from perf.people x where x.id = any (array(select perf.visible_person_ids()));

  for k, v in select * from jsonb_each(c) loop
    if jsonb_typeof(v) = 'array' then
      -- listas de nombres: solo los visibles
      r := r || jsonb_build_object(k, coalesce((select jsonb_agg(e) from jsonb_array_elements(v) e
             where jsonb_typeof(e) = 'string' and perf.nombre_clave(e #>> '{}') = any (n)), '[]'::jsonb));
    elsif jsonb_typeof(v) = 'object' and k = 'teamGroups' then
      -- grupos con alguien visible, y de cada uno solo los integrantes visibles
      r := r || jsonb_build_object(k, coalesce((select jsonb_object_agg(g.key,
               g.value || jsonb_build_object('members', coalesce((select jsonb_agg(m) from jsonb_array_elements(g.value->'members') m
                 where perf.nombre_clave(m #>> '{}') = any (n)), '[]'::jsonb)))
             from jsonb_each(v) g
             where perf.nombre_clave(g.value->>'leader') = any (n)
                or exists (select 1 from jsonb_array_elements(g.value->'members') m where perf.nombre_clave(m #>> '{}') = any (n))), '{}'::jsonb));
    elsif jsonb_typeof(v) = 'object' then
      -- mapas por nombre (asignaciones) y alias (nombre en el Excel → nombre de la persona)
      r := r || jsonb_build_object(k, coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(v) e
             where perf.nombre_clave(e.key) = any (n)
                or (jsonb_typeof(e.value) = 'string' and perf.nombre_clave(e.value #>> '{}') = any (n))), '{}'::jsonb));
    end if;
    -- cualquier otro tipo de valor no se entrega
  end loop;
  return r;
end $$;

revoke all on function perf.nombre_clave(text), perf.team_config_mio() from public, anon;
grant execute on function perf.nombre_clave(text), perf.team_config_mio() to authenticated, service_role;

-- Ajustes: "owner_…" solo el admin; team_config completa solo el admin y quien sube datos
drop policy if exists settings_select on perf.app_settings;
create policy settings_select on perf.app_settings for select to authenticated
  using ((select perf.is_owner())
         or ((select perf.is_lead_or_owner()) and key not like 'owner\_%'
             and (key <> 'team_config' or (select perf.can_upload()))));

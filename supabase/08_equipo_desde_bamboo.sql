-- =====================================================================
--  TEAM COACH · Cambio 14: crear un grupo de Team Coach a partir de Bamboo
--  Toma a un líder de Bamboo y a toda la gente que tiene debajo (según la última
--  actualización) y los agrega a Team Coach en un grupo, con el líder como lead.
--  · No duplica: si la persona ya existe (por enlace con Bamboo o por nombre), la reutiliza.
--  · No mueve de grupo a quien ya tiene uno; solo lo informa.
--  · Deja a cada persona enlazada con Bamboo (para Horas).
--  Uso (SQL Editor):  select public.import_bamboo_team('Nombre del líder', 'Nombre del grupo');
--  Se puede correr más de una vez.
-- =====================================================================
create or replace function public.import_bamboo_team(lead_name text, group_name text, group_color text default '#0e8aa8')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead   public.bamboo_employees;
  v_group  uuid;
  v_sort   int;
  e        record;
  v_pid    uuid;
  agregados text[] := '{}';
  enlazados text[] := '{}';
  en_otro   text[] := '{}';
  ya_estaban text[] := '{}';
begin
  -- Solo Gus (admin) o el SQL Editor
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Solo el admin puede crear grupos desde Bamboo.';
  end if;

  select * into v_lead from public.bamboo_employees where lower(trim(full_name)) = lower(trim(lead_name)) limit 1;
  if v_lead.bamboo_id is null then
    select * into v_lead from public.bamboo_employees
     where full_name ilike '%' || split_part(trim(lead_name), ' ', 1) || '%'
       and full_name ilike '%' || split_part(trim(lead_name), ' ', 2) || '%'
     limit 1;
  end if;
  if v_lead.bamboo_id is null then
    raise exception 'No encontré a "%" en los datos de Bamboo. Actualiza desde Bamboo y revisa cómo está escrito el nombre.', lead_name;
  end if;

  -- Grupo
  select id into v_group from public.groups where lower(name) = lower(group_name);
  if v_group is null then
    select coalesce(max(sort), 0) + 1 into v_sort from public.groups;
    insert into public.groups (name, color, sort) values (group_name, group_color, v_sort) returning id into v_group;
  end if;

  -- Líder + toda su cadena
  for e in
    with recursive cadena as (
      select b.bamboo_id, b.full_name, b.email, 0 as nivel from public.bamboo_employees b where b.bamboo_id = v_lead.bamboo_id
      union
      select b.bamboo_id, b.full_name, b.email, c.nivel + 1 from public.bamboo_employees b
      join cadena c on b.supervisor_id = c.bamboo_id where c.nivel < 20
    )
    select * from cadena order by nivel, full_name
  loop
    v_pid := null;
    select id into v_pid from public.people where bamboo_id = e.bamboo_id;
    if v_pid is null then
      select id into v_pid from public.people where lower(trim(full_name)) = lower(trim(e.full_name)) and bamboo_id is null limit 1;
      if v_pid is not null then
        update public.people set bamboo_id = e.bamboo_id where id = v_pid;
        enlazados := enlazados || e.full_name;
      end if;
    end if;
    if v_pid is null then
      insert into public.people (full_name, email, group_id, is_lead, status, bamboo_id)
      values (e.full_name, e.email, v_group, e.bamboo_id = v_lead.bamboo_id, 'activo', e.bamboo_id)
      on conflict (full_name) do nothing
      returning id into v_pid;
      if v_pid is null then   -- mismo nombre ya enlazado a otro empleado: se informa y se sigue
        en_otro := en_otro || (e.full_name || ' (nombre repetido)');
        continue;
      end if;
      agregados := agregados || e.full_name;
    else
      update public.people set group_id = v_group where id = v_pid and group_id is null;
      if exists (select 1 from public.people where id = v_pid and group_id <> v_group) then
        en_otro := en_otro || e.full_name;
      else
        ya_estaban := ya_estaban || e.full_name;
      end if;
    end if;
    if e.bamboo_id = v_lead.bamboo_id then
      update public.people set is_lead = true where id = v_pid;
      insert into public.group_leads (group_id, person_id, is_primary) values (v_group, v_pid, true)
      on conflict (group_id, person_id) do nothing;
    end if;
    update public.bamboo_employees set person_id = v_pid where bamboo_id = e.bamboo_id;
  end loop;

  return jsonb_build_object(
    'grupo', group_name, 'lider', v_lead.full_name,
    'agregados', to_jsonb(agregados), 'enlazados_por_nombre', to_jsonb(enlazados),
    'ya_estaban_en_el_grupo', to_jsonb(ya_estaban), 'en_otro_grupo_sin_mover', to_jsonb(en_otro));
end;
$$;

revoke all on function public.import_bamboo_team(text, text, text) from public, anon;
grant execute on function public.import_bamboo_team(text, text, text) to authenticated;

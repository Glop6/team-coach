-- =====================================================================
--  TEAM COACH · Cambio 17: historial de lo generado con IA
--  · Cada "Preparar reunión" e "Ideas con IA" queda guardado con quién lo generó y cuándo,
--    para revisarlo antes de volver a generar.
--  · Lo ve Gus y los líderes que tienen acceso a esa persona (un líder no ve lo que se generó
--    sobre él mismo ni sobre otros líderes).
--  · Solo la función "coach" lo escribe. Se puede correr más de una vez.
-- =====================================================================
create table if not exists public.ai_generations (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references public.people(id) on delete cascade,
  kind             text not null,                 -- prep | ideas
  result           jsonb not null,
  lang             text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now()
);
create index if not exists ai_generations_person_idx on public.ai_generations(person_id, kind, created_at desc);

alter table public.ai_generations enable row level security;
revoke all on public.ai_generations from anon;
revoke insert, update on public.ai_generations from authenticated;
grant select, delete on public.ai_generations to authenticated;

drop policy if exists ai_generations_select on public.ai_generations;
create policy ai_generations_select on public.ai_generations for select to authenticated
  using (public.is_admin() or public.can_write_about(person_id));
drop policy if exists ai_generations_delete on public.ai_generations;
create policy ai_generations_delete on public.ai_generations for delete to authenticated
  using (public.is_admin());

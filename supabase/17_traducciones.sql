-- =====================================================================
--  TEAM COACH · Cambio 24: todo en inglés (traducción automática con caché)
--  Cuando la app está en inglés, lo que está escrito en español (notas, temas,
--  resúmenes, pendientes, comentarios) se traduce con IA una sola vez y se guarda acá.
--  El texto original NO se cambia (en ES se ve tal como se escribió).
--  Esta tabla solo la usa la función coach (nadie la lee desde la app).
--  Correr después de 16_ingles_kudos.sql. Se puede correr más de una vez.
-- =====================================================================
create table if not exists public.translations (
  hash        text primary key,            -- sha-256 del texto original + idioma destino
  lang        text not null default 'en',
  source      text not null,
  result      text not null,
  created_at  timestamptz not null default now()
);
alter table public.translations enable row level security;
revoke all on public.translations from anon, authenticated;

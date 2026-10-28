-- =====================================================================
--  TEAM COACH · Cambio 25: tope diario de traducciones por usuario
--  Guarda quién pidió cada traducción nueva para limitar el uso de IA
--  (por defecto 1.500 textos nuevos por día y por persona; Gus sin tope).
--  Correr después de 17_traducciones.sql. Se puede correr más de una vez.
-- =====================================================================
alter table public.translations add column if not exists requested_by uuid;
create index if not exists translations_requested_by_idx on public.translations (requested_by, created_at);
-- Sigue cerrada a la app: solo la función coach (service role) la lee y escribe.
revoke all on public.translations from anon, authenticated;

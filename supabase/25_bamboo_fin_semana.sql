-- =====================================================================
--  TEAM COACH · Cambio 36: semana de Bamboo por persona
--  Va DESPUÉS de 24_perf_entregables.sql y ANTES de publicar la versión nueva de bamboo-sync.
--  Quien trabaja de domingo a lunes (por ejemplo, de jueves a lunes) cierra su semana en su último día
--  laborable y la revisión es al día siguiente a la hora límite. Para el resto, igual que antes: la semana va
--  de lunes a domingo y vence el lunes siguiente.
--  week_end: último día de la semana de esa persona (0 = lunes … 6 = domingo). Lo llena bamboo-sync a partir
--  de los horarios de Reglas, porque solo el admin puede leer rule_schedules. Vacío = 6 (domingo).
--  Re-ejecutable.
-- =====================================================================

alter table public.bamboo_employees add column if not exists week_end smallint
  check (week_end between 0 and 6);

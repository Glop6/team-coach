# Carga inicial de MS Dash → `perf`

Solo para la migración inicial (o para recrear `perf` desde cero en una base nueva). Ningún archivo de esta carpeta tiene datos del equipo. Lo que generan sí los tiene, así que va junto a los respaldos y nunca al repo.

1. **Respaldo de MS Dash** en `~/Backups/supabase/AAAA-MM-DD/ms-dash.dump` (ver `scripts/respaldo.sh`). Desde ese momento no se sube nada a MS Dash hasta terminar.
2. **Staging:** `supabase/carga/preparar_staging.sh <ms-dash.dump> <carpeta del respaldo>/msd_staging.sql` y ejecutar ese SQL en la base de Team Coach. Crea el schema `perf_staging`, sin acceso desde la API.
3. **Números de referencia:** `referencia_staging.sql` los saca de `perf_staging` (la misma foto que el respaldo) a `/tmp/ref_*.csv`.
4. **Carga:** ejecutar `perf_carga.sql` (requiere `19_perf_dashboard.sql`).
   ⚠️ Vacía `perf` y lo recarga: **nunca después del lanzamiento**.
5. **Comparar, antes de los ajustes:** `referencia_perf.sql` saca los mismos números sobre `perf` (a `/tmp/perf_*.csv`), y
   `python3 -I comparar.py <carpeta ref_*.csv> <carpeta perf_*.csv> "<ex-miembros separados por ;>"` debe terminar en `TODO COINCIDE`.
6. **Ajustes:** el SQL privado con `team_config` y `owner_people_settings` (fuera del repo, junto a los respaldos), y volver a ejecutar `21_perf_ai_tope.sql`, porque la carga borra los topes de la IA.
7. Borrar el staging: `drop schema perf_staging cascade;`

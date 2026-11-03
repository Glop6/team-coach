# Carga inicial de MS Dash → `perf`

Solo para la migración inicial (o para recrear `perf` desde cero en una base nueva). Ningún archivo de esta carpeta tiene datos del equipo. Lo que generan sí los tiene, así que va junto a los respaldos y nunca al repo.

1. **Respaldo de MS Dash** en `~/Backups/supabase/AAAA-MM-DD/ms-dash.dump` (ver `scripts/respaldo.sh`).
2. **Números de referencia** de MS Dash (`ref_*.csv`) en la misma carpeta, sacados justo antes de copiar.
3. **Staging:** `supabase/carga/preparar_staging.sh <ms-dash.dump> <carpeta del respaldo>/msd_staging.sql` y ejecutar ese SQL en la base de Team Coach. Crea el schema `perf_staging`, sin acceso desde la API.
4. **Carga:** ejecutar `perf_carga.sql` (requiere `19_perf_dashboard.sql`).
   ⚠️ Vacía `perf` y lo recarga: **nunca después del lanzamiento**.
5. **Ajustes del equipo** (`app_settings.team_config`: grupos, asignaciones, ex-miembros): están en un SQL privado, fuera del repo.
6. **Comparar:** `referencia_perf.sql` saca los mismos números sobre `perf` (a `/tmp/perf_*.csv`), y
   `python3 -I comparar.py <carpeta ref_*.csv> <carpeta perf_*.csv> "<ex-miembros separados por ;>"` debe terminar en `TODO COINCIDE`.
7. Borrar el staging: `drop schema perf_staging cascade;`

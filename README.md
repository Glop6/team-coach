# Team Coach

App interna de coaching del equipo, con la sección **Rendimiento** y las vistas detalladas del Performance Dashboard.
Usa un solo proyecto Supabase, con login y roles de Team Coach (admin, lead, member).

Este repo es público: aquí no van nombres, correos ni datos del equipo. Esos datos viven en la base y en los archivos privados que se describen abajo.

## Estructura

| Carpeta / archivo | Qué contiene |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app publicada. `app.js` se genera con `npm run build` y se commitea. |
| `src/` | Código de la app (Preact + htm). `src/config.js` tiene la dirección y la clave publishable de Supabase; también la usa el dashboard. |
| `src/perf/` | Motor de cálculo del dashboard, como módulo puro (lo usa la sección Rendimiento). |
| `dashboard/` | Vistas detalladas y comparativas del Performance Dashboard (admin y líderes). Lee el esquema `perf` y comparte la sesión con la app. |
| `supabase/NN_*.sql` | Cambios de la base, numerados en el orden en que se ejecutan. Cada uno dice al inicio qué hace y después de cuál va. |
| `supabase/functions/` | Edge Functions: `coach` (IA de reuniones), `bamboo-sync` (horas desde BambooHR) y `ai-proxy` (IA del dashboard, con topes de costo). |
| `supabase/PASOS_BAMBOO.md` | Pasos para configurar la integración con BambooHR. |

## Recrear la base desde cero

1. **Base de Team Coach (01 a 05):** estos archivos no están en el repo porque incluyen datos del equipo (están en `.gitignore`). La copia privada está en `~/Backups/supabase/AAAA-MM-DD/sql_privados/`, junto con `06b`. Los datos de `02_seed.sql` son los del primer día; para tener la base al día, se restaura el respaldo más reciente (ver *Respaldos*).
2. **Ejecutar en el SQL Editor, en este orden** (todos se pueden volver a ejecutar sin romper nada):

   | Archivo | Cambio | Fecha |
   |---|---|---|
   | `06_bamboo.sql`, después `06b_bamboo_datos.sql` (privado) | 13 · BambooHR | 2026-10-26 |
   | `07_bamboo_cron.sql` (después de publicar `bamboo-sync`) | 13b · actualización automática | 2026-10-26 |
   | `08_equipo_desde_bamboo.sql` | 14 · grupos desde Bamboo | 2026-10-26 |
   | `09_feriados_regionales.sql` | 15 · feriados regionales | 2026-10-26 |
   | `10_editar_notas.sql` | 16 · editar notas | 2026-10-26 |
   | `11_historial_ia.sql` | 17 · historial de IA | 2026-10-26 |
   | `12_incidencias.sql` | 18 · incidencias | 2026-10-26 |
   | `13_campana.sql` | 19 · campanita | 2026-10-26 |
   | `14_vista_personal.sql` | 20 · rol member ("Mi espacio") | 2026-10-27 |
   | `15_seguridad.sql` | 21 · ajustes de seguridad | 2026-10-27 |
   | `16_ingles_kudos.sql` | 22 · inglés y kudos | 2026-10-27 |
   | `17_traducciones.sql` | 24 · traducción automática | 2026-10-28 |
   | `18_cerrar_anon.sql` | 25 · funciones solo con sesión | 2026-10-28 |
   | `19_perf_dashboard.sql` | 26 · esquema `perf` (vacío) | 2026-10-29 |
   | `20_perf_resumen.sql` | 28 · resúmenes de rendimiento | 2026-10-29 |
   | `21_perf_ai_tope.sql` | 29 · topes de costo de la IA | 2026-10-29 |

3. **Exponer el esquema `perf`** en la API (Settings → API → Exposed schemas).
4. **Cargar los datos del dashboard** en `perf` (casos, QA, personas y `app_settings.team_config`). Los scripts de carga tienen nombres del equipo y se guardan fuera del repo.
5. **Edge Functions:** publicar `coach`, `bamboo-sync` y `ai-proxy`. Secretos: `ANTHROPIC_API_KEY` y `BAMBOO_API_KEY` (opcional: `BAMBOO_SUBDOMAIN`).
6. **App:** `npm install`, `npm run build` y publicar la raíz del repo (incluida `dashboard/`).

Un SQL nuevo lleva el siguiente número libre y empieza con un encabezado que dice el número de cambio, qué hace y después de cuál archivo va.

## Respaldos y exportaciones

Siempre fuera del repo, en una carpeta por fecha:

```
~/Backups/supabase/AAAA-MM-DD/
  team-coach.dump      respaldo completo (pg_dump, formato custom): esquema, datos y auth
  ref_*.csv            números de referencia para comparar después de una migración
  sql_privados/        los SQL con datos del equipo (01 a 05 y 06b)
```

Los respaldos tienen datos personales y hashes de contraseñas: no se suben a ningún repo ni a la nube sin cifrar.

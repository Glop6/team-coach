# Cambio 13 · Horas desde BambooHR

Lo que agrega:

- **Horas** (menú): vistas Semanal, Mensual, Desarrollo y Vacaciones. Cada líder ve solo a la gente que tiene debajo en Bamboo. Gus ve a todos.
- **Bloque "En Bamboo"** en el perfil de cada persona.
- **Reglas** (solo Gus): estado de la actualización, enlace entre Team Coach y Bamboo, horarios especiales, feriados por país, excluidos y configuración.
- Función **bamboo-sync**: trae de Bamboo (solo lectura) horas, PTO, goals, training y saldo de vacaciones. Aplica las mismas reglas que Bamboo Check.

## Pasos (una sola vez)

1. **SQL Editor → `06_bamboo.sql` → Run.**
   - Crea las tablas y los permisos.
   - Carga los feriados 2026 y la configuración.
   - Después corre `06b_bamboo_datos.sql` (te lo paso aparte, no está en GitHub): horario de Erika y excluidos.
   - Se puede correr más de una vez.
2. **Edge Functions → Secrets** → agregar `BAMBOO_API_KEY` con la API key de Bamboo.
   - `ANTHROPIC_API_KEY` ya existe porque la usa "coach"; con ella se interpretan los comentarios.
   - Opcional: `BAMBOO_SUBDOMAIN` (por defecto `coderoad`).
3. **Edge Functions → Deploy a new function → nombre `bamboo-sync`.**
   - Pega `functions/bamboo-sync/index.ts`.
   - En la configuración de la función, **desactiva "Verify JWT"**. La función valida la sesión por su cuenta: solo deja entrar a Gus o a la actualización automática.
4. En la app, **Reglas → Actualizar desde Bamboo**. Tarda hasta 1 minuto.
5. Revisa **Reglas → Actualización y enlaces**. Corrige los enlaces marcados para que cada líder vea a su gente.
6. **SQL Editor → `07_bamboo_cron.sql` → Run.**
   - Activa la actualización automática: de lunes a viernes, cada hora, de 8:05 a 19:05 (hora de Bolivia).

## Notas

- La API key de Bamboo vive solo en los secretos de Supabase: no en el repositorio, no en el navegador.
- Nadie puede escribir datos de Bamboo desde la app; solo los escribe la función.
- Las reglas solo las ve y edita el admin.
- Período revisado: desde el 1 del mes anterior hasta ayer. Los días más viejos quedan como historial.
- Si alguien corrige un día con alerta, se guarda cómo estaba antes.
- Los permisos de 1:1 (por ejemplo Diego ↔ Erika) siguen siendo los de Team Coach (grupos). Las horas siguen la jerarquía de Bamboo.

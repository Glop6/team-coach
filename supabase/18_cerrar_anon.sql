-- =====================================================================
--  TEAM COACH · Cambio 25: las funciones de la app solo con sesión iniciada
--  Hasta ahora, cualquiera con la clave pública (sin iniciar sesión) podía llamar
--  a las funciones de la base (por ejemplo lead_ids(), que devuelve los ID de los leads).
--  Con esto, solo los usuarios con sesión (y la función coach) pueden usarlas.
--  La app no cambia: todas sus llamadas se hacen después del login, y los triggers
--  no dependen de este permiso.
--  Correr después de 17_traducciones.sql. Se puede correr más de una vez.
--  Para deshacer: grant execute on all functions in schema public to public, anon;
-- =====================================================================

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- Las funciones que se creen más adelante tampoco quedan abiertas sin sesión
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

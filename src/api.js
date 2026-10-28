// Capa de datos: Supabase real. (La versión demo vive en demo.js)
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const TABLES = ["groups", "people", "group_leads", "meetings", "insights", "actions", "suggestions", "suggestion_updates", "profiles", "reviews", "ideas"];

export function createApi() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    demo: false,
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    onAuth(cb) {
      sb.auth.onAuthStateChange((_e, s) => cb(s));
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async changePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      await sb.rpc("password_changed");
    },
    async markSeen(kind) {
      const { data: u } = await sb.auth.getUser();
      if (!u?.user) return;
      const { error } = await sb.from("user_seen").upsert({ user_id: u.user.id, kind, seen_at: new Date().toISOString() }, { onConflict: "user_id,kind" });
      if (error) throw new Error(error.message);
    },
    async loadAll() {
      // Cambio 25: Supabase entrega como máximo 1.000 filas por consulta; se pide de a páginas para no perder datos
      // cuando una tabla crece (notas, pendientes, incidencias, comentarios).
      const todas = async (q, orden) => {
        const out = [];
        for (let i = 0; ; i += 1000) {
          let qq = q();
          for (const [c, asc] of orden) qq = qq.order(c, { ascending: asc });
          const { data, error } = await qq.range(i, i + 999);
          if (error) return { data: null, error };
          out.push(...(data ?? []));
          if (!data || data.length < 1000) return { data: out, error: null };
        }
      };
      const res = await Promise.all(
        TABLES.map((t) => todas(() => sb.from(t).select("*"), t === "group_leads" ? [["group_id", true], ["person_id", true]] : [["id", true]]))
      );
      const out = {};
      TABLES.forEach((t, i) => (out[t] = check(res[i]) ?? []));
      // Incidencias (Cambio 18): si la tabla aún no existe, la app sigue igual
      { const { data: inc, error: ie } = await todas(() => sb.from("incidents").select("*"), [["occurred_on", false], ["created_at", false], ["id", true]]);
        out.incidents = ie ? [] : inc ?? []; out.incidents_error = ie ? ie.message : null; }
      // Campanita (Cambio 19): hasta cuándo revisé cada sección. Sin la tabla, todo sigue igual.
      { const { data: us, error: ue } = await sb.from("user_seen").select("*"); out.user_seen = ue ? [] : us ?? []; out.user_seen_error = ue ? ue.message : null; }
      // Cambio 20: comentarios en pendientes y "mis reuniones" (solo personas del equipo). Sin el SQL, todo sigue igual.
      { const { data: ac, error: ae } = await todas(() => sb.from("action_comments").select("*"), [["created_at", true], ["id", true]]); out.action_comments = ae ? [] : ac ?? []; out.action_comments_error = ae ? ae.message : null; }
      { const { data: mm, error: me } = await sb.rpc("my_meetings"); out.my_meetings = me ? [] : mm ?? []; }
      // Quiénes son líderes (aunque no sean de mis grupos)
      try { const { data: lids } = await sb.rpc("lead_ids"); out.lead_ids = (lids ?? []).map((x) => (typeof x === "string" ? x : x.lead_ids ?? Object.values(x)[0])); } catch (_) { out.lead_ids = []; }
      // Reuniones que Gus compartió con un lead: solo resumen y temas
      const { data: shared } = await sb.rpc("shared_meetings");
      for (const m of shared ?? []) {
        if (!out.meetings.some((x) => x.id === m.id))
          out.meetings.push({ ...m, shared: true, analysis: m.next_topics ? { next_meeting_topics: m.next_topics } : null });
      }
      return out;
    },
    // Cambio 13: datos de Bamboo. Se cargan aparte y sin romper la app si todavía no se corrió 06_bamboo.sql.
    async loadBamboo({ admin, member } = {}) {
      const todo = async (q) => {           // pagina de a 1000 filas (límite de la API)
        const out = [];
        for (let i = 0; ; i += 1000) {
          const { data, error } = await q().range(i, i + 999);
          if (error) throw new Error(error.message);
          out.push(...(data ?? []));
          if (!data || data.length < 1000) return out;
        }
      };
      const d = new Date();
      const desde = new Date(d.getFullYear(), d.getMonth() - 2, 1).toISOString().slice(0, 10);
      try {
        const [employees, days, goals, training, pto, log] = await Promise.all([
          todo(() => sb.from("bamboo_employees").select("*").order("bamboo_id")),
          // La persona del equipo carga todo su historial (solo sus días); líderes y Gus, los últimos meses
          todo(() => (member ? sb.from("bamboo_days").select("*") : sb.from("bamboo_days").select("*").gte("day", desde)).order("bamboo_id").order("day")),
          todo(() => sb.from("bamboo_goals").select("*").order("bamboo_id")),
          todo(() => sb.from("bamboo_training").select("*").order("bamboo_id")),
          todo(() => sb.from("bamboo_pto").select("*").order("bamboo_id")),
          // Cambio 21: el registro completo solo lo ve Gus; los demás, la última actualización (si falta el SQL 15, una lista vacía)
          admin ? sb.from("bamboo_sync_log").select("*").order("started_at", { ascending: false }).limit(15).then(check)
            : sb.rpc("last_sync").then(({ data, error }) => (error ? sb.from("bamboo_sync_log").select("finished_at,ok").eq("ok", true).order("finished_at", { ascending: false }).limit(1).then(({ data: d }) => d ?? []) : data ?? [])),
        ]);
        const out = { available: true, employees, days, goals, training, pto, log };
        // Feriados y cambios por persona: los ven todos los líderes (si las tablas aún no existen, quedan vacíos)
        const suave = (t, orden) => todo(() => (orden ? sb.from(t).select("*").order(orden, { ascending: false }) : sb.from(t).select("*"))).catch(() => []);
        const [holidays, config, choices, moves] = await Promise.all([suave("rule_holidays"), suave("rule_config"), suave("holiday_choices"), suave("holiday_moves")]);
        out.rules = { holidays, config, choices, moves };
        if (admin) {
          const [schedules, excluded, changes] = await Promise.all([suave("rule_schedules"), suave("rule_excluded"), suave("rule_changes", "at")]);
          Object.assign(out.rules, { schedules, excluded, changes: changes.slice(0, 200) });
        }
        return out;
      } catch (e) {
        return { available: false, error: e.message };
      }
    },
    async syncBamboo() {
      const { data, error } = await sb.functions.invoke("bamboo-sync", { body: { source: "boton" } });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    // Tras un cambio de feriado: pide actualizar (el servidor lo limita a una vez cada 3 min)
    // Historial de IA de una persona (si la tabla aún no existe, vacío)
    async aiHistory(personId) {
      const { data, error } = await sb.from("ai_generations").select("*").eq("person_id", personId).order("created_at", { ascending: false }).limit(30);
      return error ? [] : data ?? [];
    },
    async requestSync() {
      try { const { data } = await sb.functions.invoke("bamboo-sync", { body: { source: "regla" } }); return data; } catch (_) { return null; }
    },
    async removeWhere(table, match) {
      return check(await sb.from(table).delete().match(match));
    },
    async upsert(table, rows) {
      return check(await sb.from(table).upsert(rows).select());
    },
    async insert(table, rows) {
      return check(await sb.from(table).insert(rows).select());
    },
    async update(table, id, patch) {
      return check(await sb.from(table).update(patch).eq("id", id).select());
    },
    async updateWhere(table, match, patch) {
      return check(await sb.from(table).update(patch).match(match).select());
    },
    async rpc(name, args) {
      return check(await sb.rpc(name, args));
    },
    async remove(table, id) {
      return check(await sb.from(table).delete().eq("id", id));
    },
    async fn(action, payload = {}) {
      const { data, error } = await sb.functions.invoke("coach", { body: { action, ...payload } });
      if (error) {
        let msg = error.message;
        try {
          const j = await error.context.json();
          if (j?.error) msg = j.error;
        } catch (_) {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
  };
}

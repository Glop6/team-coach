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
    async loadAll() {
      const res = await Promise.all(
        TABLES.map((t) => sb.from(t).select("*").limit(5000))
      );
      const out = {};
      TABLES.forEach((t, i) => (out[t] = check(res[i]) ?? []));
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
    async loadBamboo({ admin } = {}) {
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
          todo(() => sb.from("bamboo_days").select("*").gte("day", desde).order("bamboo_id").order("day")),
          todo(() => sb.from("bamboo_goals").select("*").order("bamboo_id")),
          todo(() => sb.from("bamboo_training").select("*").order("bamboo_id")),
          todo(() => sb.from("bamboo_pto").select("*").order("bamboo_id")),
          sb.from("bamboo_sync_log").select("*").order("started_at", { ascending: false }).limit(15).then(check),
        ]);
        const out = { available: true, employees, days, goals, training, pto, log };
        if (admin) {
          const [schedules, holidays, excluded, config] = await Promise.all(["rule_schedules", "rule_holidays", "rule_excluded", "rule_config"]
            .map((t) => todo(() => sb.from(t).select("*"))));
          out.rules = { schedules, holidays, excluded, config };
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

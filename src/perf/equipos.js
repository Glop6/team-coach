// Cambio 33: los tres equipos del Monthly Meeting (Primary, SEO y Copywriters), que nunca se mezclan.
// Único lugar de esta regla: la usan Rendimiento (app) y el dashboard (dashboard/index.html, con import dinámico).
// - Quien está en un equipo dedicado (teamGroups.seo / teamGroups.copywriters de team_config) cuenta ahí con todo
//   su trabajo, salvo los de msPrimaryAlways, que siempre van a Primary.
// - El resto se reparte por el proyecto de cada fila: SEO / Copywriting a su equipo; lo demás, Primary.
// - QA va por persona (sin equipo dedicado = Primary).
// Las claves de persona son nombres normalizados (minúsculas, sin tildes), como en team_config.
import { PROJECT_LABELS } from "./motor.js";

export const EQUIPOS = ["primary", "seo", "cw"];

// Nombre → clave (igual que normKey del dashboard, sin la parte de correos)
export const claveNombre = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Arma el reparto una vez (el dashboard lo usa en cada fila). cfg = { teamGroups, msPrimaryAlways } de team_config.
export function crearReparto(cfg = {}) {
  const g = cfg.teamGroups || {};
  const delGrupo = (x) => new Set(x ? [x.leader, ...(x.members || [])].filter(Boolean) : []);
  const siemprePrimary = new Set(cfg.msPrimaryAlways || []), seo = delGrupo(g.seo), cw = delGrupo(g.copywriters);
  const persona = (key) => (siemprePrimary.has(key) ? "primary" : seo.has(key) ? "seo" : cw.has(key) ? "cw" : null);
  const fila = (key, proyecto) => persona(key) ?? (proyecto === PROJECT_LABELS.seo ? "seo" : proyecto === PROJECT_LABELS.cw ? "cw" : "primary");
  const qa = (key) => persona(key) ?? "primary";
  return { persona, fila, qa };
}

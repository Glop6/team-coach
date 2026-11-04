// Cambio 34: reglas de QA. Único lugar en JS: las usan el dashboard (dashboard/index.html, con import dinámico),
// motor.js y Rendimiento. Su par en SQL es perf.es_na / perf.clase_qa (supabase/23_perf_qa_reglas.sql), con las
// mismas expresiones: si cambias una, cambia la otra.
// - NA: la respuesta de la persona (QA Fix Comment) empieza con "NA" / "N/A" / "N.A" (también tras "1."), y en
//   ninguna parte dice que algo se corrigió ("fix", "fixed"...). Una respuesta mixta (NA en un punto, Fixed en
//   otro) es bug.
// - Bug: Failed o Critical sin NA. Es lo único que cuenta como error.
// - Oportunidad: Opportunity u Observed sin NA. No es bug; se cuenta aparte.
// - Sin falla: Passed, o cualquier Failed / Critical / Opportunity / Observed con NA.
// - En curso: In progress. No entra en el cálculo (tampoco un estado desconocido).
// Los porcentajes van sobre las revisiones cerradas (bugs + oportunidades + sin falla) y suman 100 %.

const RE_NA = /^\s*([0-9]+\s*[.)-]?\s*)?n\s*[/.]?\s*a([^a-z0-9_]|$)/i;
const RE_FIX = /(^|[^a-z0-9_])fix(ed|es|ing)?([^a-z0-9_]|$)/i;

export const esNA = (fixComment) => { const s = String(fixComment ?? ""); return RE_NA.test(s) && !RE_FIX.test(s); };

// r = { qaStatus, isNA } → "bug" | "oportunidad" | "sin_falla" | "en_curso" | null (estado desconocido)
export function claseQa(r) {
  switch (r.qaStatus) {
    case "Passed": return "sin_falla";
    case "Failed": case "Critical": return r.isNA ? "sin_falla" : "bug";
    case "Opportunity": case "Observed": return r.isNA ? "sin_falla" : "oportunidad";
    case "In progress": return "en_curso";
    default: return null;
  }
}

export const esBug = (r) => claseQa(r) === "bug";
// Un hallazgo (Failed / Critical / Opportunity / Observed) que pasó a sin falla por NA
export const esNaAplicado = (r) => r.qaStatus !== "Passed" && claseQa(r) === "sin_falla";
export const esCerrada = (r) => { const c = claseQa(r); return c === "bug" || c === "oportunidad" || c === "sin_falla"; };

// Conteos de una lista de revisiones, con el desglose que muestran las pantallas
export function resumenQa(list) {
  const s = { total: 0, cerradas: 0, bugs: 0, critical: 0, failed: 0, oportunidades: 0, opportunity: 0, observed: 0, sinFalla: 0, passed: 0, na: 0, enCurso: 0 };
  for (const r of list) {
    s.total++;
    const c = claseQa(r);
    if (c === "bug") { s.bugs++; if (r.qaStatus === "Critical") s.critical++; else s.failed++; }
    else if (c === "oportunidad") { s.oportunidades++; if (r.qaStatus === "Opportunity") s.opportunity++; else s.observed++; }
    else if (c === "sin_falla") { s.sinFalla++; if (esNaAplicado(r)) s.na++; else s.passed++; }
    else if (c === "en_curso") s.enCurso++;
  }
  s.cerradas = s.bugs + s.oportunidades + s.sinFalla;
  const pct = (n) => (s.cerradas ? (n / s.cerradas) * 100 : null);
  s.pctBugs = pct(s.bugs); s.pctOportunidades = pct(s.oportunidades); s.pctSinFalla = pct(s.sinFalla);
  return s;
}

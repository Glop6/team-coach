// Cambio 27: motor de cálculo del Performance Dashboard, separado de la pantalla.
// Funciones puras: reciben los casos y las selecciones, y devuelven números. Sin DOM ni estado global.
// Copia fiel de las funciones del dashboard original (mismos nombres, mismas reglas); lo que allá
// salía de variables globales (filtros, proyecto abierto) acá llega en `sel`.
// LOE: siempre en minutos (la columna del Excel es "LOE min"). Para mostrar horas: minutos / 60.

import { esBug, esCerrada, resumenQa } from "./qa.js";

export const PROJECT_LABELS = {
  postings: "CodeRoad Internal - Postings",
  lp: "CodeRoad Internal - LP",
  reworks: "CodeRoad Internal - Reworks",
  seo: "CodeRoad Internal - SEO",
  core_seo: "CodeRoad Internal - Core SEO",
  cw: "CodeRoad Internal - Copywriting",
  site_services: "Site Services",
  blog: "CodeRoad Internal - Blogs",
  ms_ops: "CodeRoad Internal - MS Ops Support",
  grooming: "CodeRoad Internal - Design Grooming",
  studio: "CodeRoad Internal - Studio",
  audit: "CodeRoad Internal - Audit",
  ppr_seo: "CodeRoad Internal - PPR SEO",
  via_slack: "CodeRoad Internal - Via Slack",
  frontline: "CodeRoad Internal - Frontline",
};

export const FOLLOWUP_LABELS = {
  ssSupport: "Site Services Support",
  ssRework: "Site Services Rework",
  recheck: "Re-check (Landing Pages)",
  reworks: "Reworks project (LPs / Postings)",
};

// Selección por defecto: lo mismo que el dashboard sin filtros.
export const SEL_VACIA = { status: "ALL", project: [], system: [], person: [], workType: [], from: null, to: null, hourFrom: null, hourTo: null, drillProject: null };
const conSel = (sel) => (sel ? { ...SEL_VACIA, ...sel } : SEL_VACIA);

// ---------- filas de la base → registros ----------
// Mismo nombre de persona escrito distinto en los Excel. Se aplica después de la clave de duplicados,
// así que solo cambia cómo se agrupa y se muestra. `alias` viene de perf.app_settings (team_config.ownerAliases).
export function canonOwner(rec, alias = {}) {
  const a = rec && alias[rec.ownerKey];
  if (a) {
    rec.ownerKey = a;
    rec.ownerDisplay = a.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return rec;
}

export function rowToRec(w, alias) {
  const x = w.extra || {};
  return canonOwner({
    dedupKey: w.dedup_key, caseId: x.caseIdIsNumber && w.case_id !== null ? Number(w.case_id) : w.case_id,
    title: w.title, ownerRaw: w.owner_raw, ownerKey: x.ownerKey, ownerDisplay: x.ownerDisplay,
    date: w.event_date ? new Date(w.event_date) : null, project: w.project, workType: w.work_type,
    account: x.account ?? null, status: x.status ?? null,
    loe: w.loe_manual !== null && w.loe_manual !== undefined ? Number(w.loe_manual) : w.loe === null ? null : Number(w.loe),
    loeManual: w.loe_manual !== null && w.loe_manual !== undefined, loeOk: !!w.loe_ok,
    sourceFile: w.source_file, sourceSheet: x.sourceSheet, loadedAt: x.loadedAt ? new Date(x.loadedAt) : null,
    isQueue: !!x.isQueue, sourceType: x.sourceType, guid: x.guid ?? null, description: x.description ?? null,
    url: x.url ?? null, originalType: x.originalType ?? null, deliverablesUsed: x.deliverablesUsed ?? null,
    importBatchId: w.import_batch_id || null, system: w.system, personId: w.person_id || null,
  }, alias);
}

export function rowToQaRec(w, alias) {
  const x = w.extra || {};
  return canonOwner({
    dedupKey: w.dedup_key, caseId: x.caseIdIsNumber && w.case_id !== null ? Number(w.case_id) : w.case_id,
    ownerRaw: w.owner_raw, ownerKey: x.ownerKey, ownerDisplay: x.ownerDisplay, qaStatus: w.qa_status, qaComment: x.qaComment ?? null,
    reviewerRaw: w.reviewer, reviewerDisplay: x.reviewerDisplay ?? null, dateCompleted: w.date_completed ? new Date(w.date_completed) : null,
    fixComment: w.fix_comment, secondaryDate: w.secondary_date ? new Date(w.secondary_date) : null, qaType: x.qaType ?? null,
    sourceFile: x.sourceFile ?? null, sourceSheet: x.sourceSheet ?? null, loadedAt: x.loadedAt ? new Date(x.loadedAt) : null,
    importBatchId: w.import_batch_id || null, followUpLevel: w.follow_up_level === undefined ? null : w.follow_up_level,
    isNA: !!w.is_na, sourceType: "qa", personId: w.person_id || null,
  }, alias);
}

// ---------- filtros ----------
export function timeOfDayMinutes(date) { return date.getHours() * 60 + date.getMinutes(); }

export function applyFilters(records, sel) {
  const f = conSel(sel);
  return records.filter((r) => {
    if (f.project.length && !f.project.includes(r.project)) return false;
    if (f.system.length && !f.system.includes(r.system)) return false;
    if (f.person.length && !f.person.includes(r.ownerKey)) return false;
    if (f.workType.length && !f.workType.includes(r.workType)) return false;
    if (f.status !== "ALL" && (r.status || "Completed (inferred)") !== f.status) return false;
    if (f.from && r.date && r.date < f.from) return false;
    if (f.to && r.date && r.date > f.to) return false;
    if (f.hourFrom !== null || f.hourTo !== null) {
      if (!r.date) return false; // sin hora: queda fuera cuando hay filtro de horario
      const mins = timeOfDayMinutes(r.date);
      if (f.hourFrom !== null && mins < f.hourFrom) return false;
      if (f.hourTo !== null && mins > f.hourTo) return false;
    }
    return true;
  });
}

// ---------- qué cuenta como caso ----------
// Por defecto solo cuenta el trabajo "terminado"; CW conserva su estado para poder incluirlo con el filtro.
export function isCounted(r, sel) {
  const f = conSel(sel);
  if (f.status !== "ALL") return true;
  if (r.sourceType === "cw") return r.status === "Completed";
  if (r.sourceType === "site_services" && r.status) return r.status.startsWith("Closed");
  return true;
}

// Seguimiento = trabajo extra sobre casos que ya existen (Support / Rework de Site Services, el proyecto
// Reworks y los Re-checks). No cuenta como caso nuevo salvo que se filtre por él; su LOE sí suma horas.
export function followUpKind(r) {
  if (r.project === PROJECT_LABELS.site_services && r.workType === "Support") return "ssSupport";
  if (r.project === PROJECT_LABELS.site_services && r.workType === "Rework") return "ssRework";
  if (r.workType === "Recheck") return "recheck";
  if (r.project === PROJECT_LABELS.reworks) return "reworks";
  return null;
}

export function followUpCounts(list) {
  const c = { ssSupport: 0, ssRework: 0, recheck: 0, reworks: 0, total: 0 };
  list.forEach((r) => { const k = followUpKind(r); if (k) { c[k]++; c.total++; } });
  return c;
}

export function countsAsCase(r, sel) {
  const k = followUpKind(r);
  if (!k) return true;
  const f = conSel(sel);
  if (k === "reworks" && (f.project.includes(r.project) || f.drillProject === r.project)) return true;
  if ((k === "ssSupport" || k === "ssRework" || k === "recheck") && f.workType.includes(r.workType)) return true;
  return false;
}

const tieneLoe = (r) => r.loe !== null && !isNaN(r.loe);

export function metrics(records, sel) {
  const list = records.filter((r) => isCounted(r, sel));
  const people = new Set(list.filter((r) => !r.isQueue).map((r) => r.ownerKey));
  const totalCases = list.filter((r) => countsAsCase(r, sel)).length;
  const followUps = followUpCounts(list);
  const loeVals = list.filter(tieneLoe);
  const totalLOE = loeVals.reduce((s, r) => s + r.loe, 0);
  const caseLoeCount = loeVals.filter((r) => countsAsCase(r, sel)).length;
  return {
    totalCases, supportCases: followUps.ssSupport, reworkCases: followUps.ssRework, followUps, totalLOE,
    avgLOE: caseLoeCount ? totalLOE / caseLoeCount : 0,
    activePeople: people.size,
    avgCasesPerPerson: people.size ? totalCases / people.size : 0,
    list,
  };
}

export function groupCount(list, keyFn, sel) {
  const m = {};
  list.forEach((r) => { if (!countsAsCase(r, sel)) return; const k = keyFn(r) || "Not available"; m[k] = (m[k] || 0) + 1; });
  return m;
}
// Como groupCount pero cuenta todas las filas (Support / Rework incluidos): para desgloses por tipo de trabajo.
export function groupCountAll(list, keyFn) {
  const m = {};
  list.forEach((r) => { const k = keyFn(r) || "Not available"; m[k] = (m[k] || 0) + 1; });
  return m;
}
export function groupLOE(list, keyFn) {
  const m = {};
  list.forEach((r) => { if (!tieneLoe(r)) return; const k = keyFn(r) || "Not available"; m[k] = (m[k] || 0) + r.loe; });
  return m;
}

// ---------- periodos y tendencia ----------
export function previousPeriod(from, to) {
  if (!from || !to) return null;
  const len = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - len - 86400000), to: new Date(from.getTime() - 86400000) };
}

export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1) - day);
  return x;
}

const dos = (n) => String(n).padStart(2, "0");
export function periodKey(date, granularity) {
  if (!date) return null;
  if (granularity === "day") return `${date.getFullYear()}-${dos(date.getMonth() + 1)}-${dos(date.getDate())}`;
  if (granularity === "week") return mondayOf(date).toISOString().slice(0, 10);
  if (granularity === "month") return `${date.getFullYear()}-${dos(date.getMonth() + 1)}`;
  if (granularity === "quarter") return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
  return `${date.getFullYear()}`;
}

export function periodSortKey(key, granularity) {
  if (granularity === "quarter") { const [y, q] = key.split("-Q"); return +y * 10 + +q; }
  return key;
}

export function buildTrendData(list, granularity, sel) {
  const byPeriod = {}; // clave -> {cases, loe, loeCount, byProject:{proyecto:casos}}
  list.forEach((r) => {
    if (!r.date) return;
    const k = periodKey(r.date, granularity);
    const p = byPeriod[k] || (byPeriod[k] = { cases: 0, loe: 0, loeCount: 0, byProject: {} });
    const cuenta = countsAsCase(r, sel);
    if (cuenta) { p.cases++; p.byProject[r.project] = (p.byProject[r.project] || 0) + 1; }
    if (tieneLoe(r)) { p.loe += r.loe; if (cuenta) p.loeCount++; }
  });
  const keys = Object.keys(byPeriod).sort((a, b) => {
    const sa = periodSortKey(a, granularity), sb = periodSortKey(b, granularity);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return { keys, byPeriod };
}

// ---------- QA ----------
// Cambio 34: las reglas de QA (bug, oportunidad, sin falla, NA) viven en qa.js. Error real = bug.
export const isRealError = esBug;

// Con una serie mensual de tasas: ¿las últimas `months` transiciones subieron todas (empeora) o bajaron todas (mejora)?
export function trailingStreak(rates, months) {
  if (rates.length < months + 1) return { worsening: false, improving: false };
  let w = 0, imp = 0;
  for (let i = rates.length - 1; i >= rates.length - months; i--) {
    if (rates[i] > rates[i - 1] + 0.01) w++;
    else if (rates[i] < rates[i - 1] - 0.01) imp++;
  }
  return { worsening: w === months, improving: imp === months };
}

// Resumen de QA por persona (la tabla "By specialist" del dashboard). `meses` = racha para la tendencia.
export function qaBySpecialist(list, meses = 3) {
  const by = {};
  list.forEach((r) => {
    (by[r.ownerKey] || (by[r.ownerKey] = { display: r.ownerDisplay, list: [], fu1: 0, fu2: 0, fu3: 0, byMonth: {} })).list.push(r);
    const b = by[r.ownerKey];
    const err = esBug(r);
    if (r.followUpLevel !== null && r.followUpLevel >= 1) { if (r.followUpLevel >= 3) b.fu3++; else if (r.followUpLevel === 2) b.fu2++; else b.fu1++; }
    if (r.dateCompleted && esCerrada(r)) {
      const mk = periodKey(r.dateCompleted, "month");
      const m = b.byMonth[mk] || (b.byMonth[mk] = { total: 0, error: 0 });
      m.total++;
      if (err) m.error++;
    }
  });
  return Object.entries(by).map(([key, b]) => {
    const q = resumenQa(b.list);
    const mkeys = Object.keys(b.byMonth).sort();
    const monthlyRates = mkeys.map((mk) => { const m = b.byMonth[mk]; return m.total ? (m.error / m.total) * 100 : 0; });
    const streak = trailingStreak(monthlyRates, meses);
    const trend = streak.worsening ? "worsening" : streak.improving ? "improving" : monthlyRates.length >= 2 ? "stable" : null;
    return { key, display: b.display, ...q, realErrors: q.bugs, errorRate: q.pctBugs ?? 0, trend, streak,
      fu1: b.fu1, fu2: b.fu2, fu3: b.fu3, fuTotal: b.fu1 + b.fu2 + b.fu3, byMonth: b.byMonth };
  });
}

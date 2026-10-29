// =====================================================================
//  Cambio 28: sección Rendimiento (datos del Performance Dashboard)
//  Tres niveles: Inicio (admin) → Grupo (líder y admin) → Persona.
//  - Admin: todo, incluidas las comparativas (dashboard aparte) y los ex-miembros.
//  - Líder: solo sus grupos, con totales completos y capacity. Sin rankings: la lista va por
//    nombre y la tendencia de cada persona es contra su propio historial.
//  - Persona: solo lo suyo. Si no tiene casos, la sección no aparece.
//  Los números vienen resumidos de la base (20_perf_resumen.sql), con las reglas de perf/motor.js.
//  Se cruzan con Team Coach: grupos, reuniones, incidencias, kudos y horas de Bamboo.
//  LOE en minutos; se muestra en horas.
// =====================================================================
import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import htm from "htm";
import { useApp, t, getLang, Avatar, Empty, Busy, MEETING_KIND } from "./app.js";
import { esKudos } from "./incidencias.js";
import { PERF_DASHBOARD_URL } from "./config.js";

const html = htm.bind(h);
const N_MESES = 12;
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const cero = () => Array(N_MESES).fill(0);
const nf = (n, d = 0) => Number(n || 0).toLocaleString(getLang() === "en" ? "en-US" : "es-BO", { minimumFractionDigits: d, maximumFractionDigits: d });
const hrs = (min) => (min || 0) / 60;
const fechaMes = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1);
const mesLargo = (k) => fechaMes(k).toLocaleDateString(getLang() === "en" ? "en-US" : "es", { month: "long", year: "numeric" });
const mesNombre = (k) => fechaMes(k).toLocaleDateString(getLang() === "en" ? "en-US" : "es", { month: "long" });
const mesCorto = (k) => fechaMes(k).toLocaleDateString(getLang() === "en" ? "en-US" : "es", { month: "short" }).replace(".", "") + (k.endsWith("-01") ? " " + k.slice(2, 4) : "");
const mesDe = (d) => String(d ?? "").slice(0, 7);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

// Desde cuándo se piden los resúmenes: 13 meses (12 de tendencia + margen) y 3 meses para el horario
export function rangoPerf() {
  const d = new Date();
  return { desde: ymd(new Date(d.getFullYear(), d.getMonth() - 13, 1)), desdeHorario: ymd(new Date(d.getFullYear(), d.getMonth() - 3, 1)) };
}

// ---------------------------------------------------------------------
// Modelo: una ficha por persona del dashboard, con sus series de 12 meses y lo cruzado de Team Coach
// ---------------------------------------------------------------------
function construirModelo(perf, data, bamboo) {
  // "Ahora" = el último mes CERRADO con datos: el mes en curso siempre está incompleto
  // (los datos se suben una vez al mes, a mes vencido).
  const enCurso = mesDe(ymd(new Date()));
  const conDatos = perf.casos.filter((r) => r.casos > 0 && r.mes < enCurso).map((r) => r.mes);
  if (!conDatos.length) return null;
  const ahora = conDatos.sort().at(-1);
  const meses = []; for (let i = N_MESES - 1; i >= 0; i--) { const d = fechaMes(ahora); meses.push(mesDe(ymd(new Date(d.getFullYear(), d.getMonth() - i, 1)))); }
  const iMes = new Map(meses.map((m, i) => [m, i]));
  const tcPeople = new Map(data.people.map((p) => [p.id, p]));
  const personas = new Map();
  for (const p of perf.people) {
    const tc = p.tc_person_id ? tcPeople.get(p.tc_person_id) ?? null : null;
    personas.set(p.id, { id: p.id, nombre: tc?.full_name ?? p.full_name, active: p.active, tc, group_id: tc?.group_id ?? null,
      cases: cero(), loe: cero(), qaTot: cero(), qaErr: cero(), qaProg: cero(), proj: meses.map(() => ({})), hora: Array(24).fill(0), dia: Array(7).fill(0),
      inc: cero(), kudos: cero(), reuniones: [], bamboo: meses.map(() => null), conCasos: false });
  }
  for (const r of perf.casos) {
    const p = personas.get(r.person_id), i = iMes.get(r.mes);
    if (!p || i === undefined) continue;
    p.cases[i] += r.casos; p.loe[i] += Number(r.loe_min);
    const pr = p.proj[i][r.proyecto] ?? (p.proj[i][r.proyecto] = { casos: 0, loe: 0 });
    pr.casos += r.casos; pr.loe += Number(r.loe_min);
    if (r.casos > 0) p.conCasos = true;
  }
  for (const r of perf.qa) {
    const p = personas.get(r.person_id), i = iMes.get(r.mes);
    if (!p || i === undefined) continue;
    p.qaTot[i] += r.total; p.qaErr[i] += r.errores; p.qaProg[i] += r.en_progreso;
  }
  for (const r of perf.horario) { const p = personas.get(r.person_id); if (p) { p.hora[r.hora] += r.casos; p.dia[r.dia - 1] += r.casos; } }
  const porTc = new Map([...personas.values()].filter((p) => p.tc).map((p) => [p.tc.id, p]));
  for (const x of data.incidents ?? []) {
    const p = porTc.get(x.person_id), i = iMes.get(mesDe(x.occurred_on));
    if (p && !x.voided && i !== undefined) (esKudos(x) ? p.kudos : p.inc)[i]++;
  }
  const vistas = new Set();
  for (const m of [...(data.meetings ?? []), ...(data.my_meetings ?? [])]) {
    const p = porTc.get(m.person_id);
    if (p && !vistas.has(m.id)) { vistas.add(m.id); p.reuniones.push(m); }
  }
  if (bamboo?.available) {
    const porBamboo = new Map([...personas.values()].filter((p) => p.tc?.bamboo_id).map((p) => [String(p.tc.bamboo_id), p]));
    for (const d of bamboo.days ?? []) {
      const p = porBamboo.get(String(d.bamboo_id)), i = iMes.get(mesDe(d.day));
      if (!p || i === undefined) continue;
      const b = p.bamboo[i] ?? (p.bamboo[i] = { h: 0, e: 0 });
      b.h += Number(d.hours || 0); b.e += Number(d.expected || 0);
    }
  }
  return { meses, ahora, personas };
}

// Suma de varias personas (un grupo, el equipo)
function serie(ps) {
  const s = { cases: cero(), loe: cero(), qaTot: cero(), qaErr: cero(), qaProg: cero(), inc: cero(), kudos: cero() };
  for (const p of ps) for (const k of Object.keys(s)) p[k].forEach((v, i) => (s[k][i] += v));
  return s;
}
const tasaError = (s, i) => { const r = s.qaTot[i] - s.qaProg[i]; return r > 0 ? (s.qaErr[i] / r) * 100 : null; };
// Tendencia: promedio de los 3 meses hasta i contra los 3 anteriores (±5 %)
function tendencia(vals, i) {
  const a = vals.slice(Math.max(0, i - 2), i + 1), b = vals.slice(Math.max(0, i - 5), Math.max(0, i - 2));
  if (b.length < 3 || !sum(b)) return { k: null, txt: "—" };
  const d = (sum(a) / a.length - sum(b) / b.length) / (sum(b) / b.length);
  if (d > 0.05) return { k: "sube", txt: t("▲ 3 meses: sube") };
  if (d < -0.05) return { k: "baja", txt: t("▼ 3 meses: baja") };
  return { k: "estable", txt: t("● 3 meses: estable") };
}
function vsAnterior(ahora, antes, mesAntes) {
  if (!antes) return t("sin dato del mes anterior");
  const d = ((ahora - antes) / antes) * 100;
  return `${d > 0.5 ? "▲" : d < -0.5 ? "▼" : "●"} ${t("{p}% vs {m}", { p: nf(Math.abs(d)), m: mesCorto(mesAntes) })}`;
}

// ---------------------------------------------------------------------
// Permisos de vista (la base ya filtra; esto ajusta lo que se muestra, por ejemplo al uploader líder)
// ---------------------------------------------------------------------
function usarRendimiento() {
  const ctx = useApp();
  const { perf, data, bamboo, isAdmin, isMember, me, idx } = ctx;
  const modelo = useMemo(() => (perf?.available ? construirModelo(perf, data, bamboo) : null), [perf, data, bamboo]);
  const misGrupos = isAdmin ? data.groups : idx.groupsLedBy(me?.person_id);
  const idsGrupos = new Set(misGrupos.map((g) => g.id));
  const puedeGrupo = (gid) => isAdmin || idsGrupos.has(gid);
  const puedePersona = (p) => !!p && (isAdmin || (isMember ? p.tc?.id === me?.person_id : p.active && idsGrupos.has(p.group_id)) || (!!me?.person_id && p.tc?.id === me.person_id));
  // Activos = personas del equipo con ficha en Team Coach (la cuenta del admin no tiene ficha y queda fuera)
  const activos = modelo ? [...modelo.personas.values()].filter((p) => p.active && p.tc) : [];
  const miembros = (gid) => activos.filter((p) => p.group_id === gid).sort((a, b) => a.nombre.localeCompare(b.nombre));
  return { ...ctx, modelo, misGrupos, puedeGrupo, puedePersona, activos, miembros };
}

// Para el menú: ¿mostrar la sección? (persona sin casos → no)
export function hayRendimiento(ctx) {
  const { perf, isAdmin, isMember, me, idx } = ctx;
  if (!perf?.available || !perf.casos.length) return false;
  if (isAdmin) return true;
  if (isMember) {
    const mio = perf.people.find((p) => p.tc_person_id === me?.person_id);
    return !!mio && perf.casos.some((r) => r.person_id === mio.id && r.casos > 0);
  }
  return idx.groupsLedBy(me?.person_id).length > 0;
}

// ---------------------------------------------------------------------
// Gráficos: una serie, SVG, sin librerías. El mes elegido se resalta; el detalle va en el tooltip.
// ---------------------------------------------------------------------
function Barras({ vals, meses, sel, color = "var(--primary)", fmt = (v) => nf(v), alto = 150, ancho = 640, eventos = null, etiqueta = "" }) {
  const padB = 20, padT = eventos ? 26 : 18, gap = 6, n = vals.length, bw = (ancho - gap * (n - 1)) / n;
  const max = Math.max(1, ...vals.map((v) => v || 0));
  return html`<svg class="rd-barras" viewBox=${`0 0 ${ancho} ${alto}`} width="100%" role="img" aria-label=${etiqueta}>
    <line x1="0" x2=${ancho} y1=${alto - padB + 0.5} y2=${alto - padB + 0.5} />
    ${vals.map((v, i) => {
      const x = i * (bw + gap), bh = Math.max(v ? 2 : 0, ((v || 0) / max) * (alto - padB - padT)), y = alto - padB - bh, r = Math.min(4, bw / 2, bh);
      const ev = eventos?.[i];
      return html`<g key=${i}>
        <title>${mesLargo(meses[i])}: ${v == null ? t("sin dato") : fmt(v)}${ev ? " · " + ev.txt : ""}</title>
        <rect x=${x - gap / 2} y="0" width=${bw + gap} height=${alto} fill="transparent" />
        ${bh > 0 && html`<path d=${`M${x},${alto - padB} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${alto - padB} Z`} style=${`fill:${color};opacity:${i === sel ? 1 : 0.38}`} />`}
        ${i === sel && v ? html`<text x=${x + bw / 2} y=${y - 4} text-anchor="middle" class="rd-valor">${fmt(v)}</text>` : null}
        <text x=${x + bw / 2} y=${alto - 5} text-anchor="middle">${mesCorto(meses[i])}</text>
        ${ev && ev.colores.map((c, j) => html`<circle cx=${x + bw / 2 + (j - (ev.colores.length - 1) / 2) * 11} cy="8" r="4.5" class="rd-ev" style=${`stroke:${c}`} />`)}
      </g>`;
    })}
  </svg>`;
}

function Linea({ vals, color = "var(--primary)", ancho = 160 }) {
  const alto = 34, max = Math.max(1, ...vals), paso = ancho / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => [i * paso, alto - 3 - ((v || 0) / max) * (alto - 8)]);
  const [lx, ly] = pts.at(-1);
  return html`<svg viewBox=${`0 0 ${ancho} ${alto}`} width=${ancho} height=${alto} aria-hidden="true" class="rd-linea">
    <polyline points=${pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")} fill="none" stroke=${color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".85" />
    <circle cx=${lx} cy=${ly} r="4" fill=${color} stroke="var(--surface)" stroke-width="2" />
  </svg>`;
}

function BarrasH({ filas, color = "var(--primary)", fmt = (v) => nf(v) }) {
  const max = Math.max(1, ...filas.map((f) => f[1]));
  return html`<div>${filas.map(([k, v]) => html`<div class="rd-hbar" key=${k} title=${`${k}: ${fmt(v)}`}>
    <span class="rd-hbar-k">${k.replace("CodeRoad Internal - ", "")}</span>
    <span class="rd-hbar-t"><span style=${`width:${(v / max) * 100}%;background:${color}`}></span></span>
    <span class="rd-hbar-n">${fmt(v)}</span></div>`)}</div>`;
}

function Horario({ p }) {
  const horas = Array.from({ length: 17 }, (_, i) => i + 6), max = Math.max(1, ...p.hora), dmax = Math.max(1, ...p.dia);
  const dias = [t("lun"), t("mar"), t("mié"), t("jue"), t("vie"), t("sáb"), t("dom")];
  const col = (v, m) => html`<span style=${`height:${(v / m) * 100}%;min-height:${v ? 2 : 0}px;opacity:${0.4 + 0.6 * (v / m)}`}></span>`;
  return html`<div class="rd-horas">${horas.map((hr) => html`<div key=${hr} title=${t("{h}:00 · {n} casos", { h: hr, n: nf(p.hora[hr]) })}>${col(p.hora[hr], max)}</div>`)}</div>
    <div class="rd-horas-ej">${horas.map((hr) => html`<span key=${hr}>${hr % 3 === 0 ? hr + "h" : ""}</span>`)}</div>
    <div class="rd-dias">${p.dia.map((v, i) => html`<div key=${i} title=${`${dias[i]}: ${t("{n} casos", { n: nf(v) })}`}><div>${col(v, dmax)}</div>${dias[i]}</div>`)}</div>`;
}

const EV = { reunion: "var(--primary)", incidencia: "var(--late)", kudos: "var(--gold)" };
function eventosDe(p, meses) {
  return meses.map((m, i) => {
    const colores = [], txt = [];
    const r = p.reuniones.filter((x) => mesDe(x.meeting_date) === m).length;
    if (r) { colores.push(EV.reunion); txt.push(r === 1 ? t("1 reunión") : t("{n} reuniones", { n: r })); }
    if (p.inc[i]) { colores.push(EV.incidencia); txt.push(p.inc[i] === 1 ? t("1 incidencia") : t("{n} incidencias", { n: p.inc[i] })); }
    if (p.kudos[i]) { colores.push(EV.kudos); txt.push(t("{n} kudos", { n: p.kudos[i] })); }
    return colores.length ? { colores, txt: txt.join(", ") } : null;
  });
}
const LeyendaEventos = () => html`<div class="rd-leyenda"><span><i class="dot" style=${`background:${EV.reunion}`}></i> ${t("reunión")}</span><span><i class="dot" style=${`background:${EV.incidencia}`}></i> ${t("incidencia")}</span><span><i class="dot" style=${`background:${EV.kudos}`}></i> ${t("kudos")}</span></div>`;

// ---------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------
function SelectorMes({ meses, sel, onSel }) {
  return html`<div class="rd-meses" role="group" aria-label=${t("Mes")}>${meses.map((m, i) => i > 0 && html`<button key=${m} class=${i === sel ? "on" : ""} aria-pressed=${i === sel} onClick=${() => onSel(i)}>${mesCorto(m)}</button>`)}</div>`;
}

function Kpi({ etiqueta, valor, unidad, debajo, extra }) {
  return html`<div class="rd-kpi"><div class="rd-kpi-l">${etiqueta}</div><div class="rd-kpi-v">${valor}${unidad && html`<small>${unidad}</small>`}</div><div class="rd-kpi-c">${debajo}</div>${extra}</div>`;
}

function Kpis({ s, meses, i, color, cuarto }) {
  const e = tasaError(s, i), eb = i > 0 ? tasaError(s, i - 1) : null, ant = meses[i - 1];
  const tc = tendencia(s.cases, i), tl = tendencia(s.loe, i);
  const qaPill = e == null || eb == null ? null
    : e < eb - 0.3 ? html`<span class="pill hb-ok">✓ ${t("mejor que {m}", { m: mesCorto(ant) })}</span>`
    : e > eb + 0.3 ? html`<span class="pill hb-bad">! ${t("peor que {m}", { m: mesCorto(ant) })}</span>`
    : html`<span class="pill">● ${t("igual que {m}", { m: mesCorto(ant) })}</span>`;
  return html`<div class="rd-kpis">
    <${Kpi} etiqueta=${t("Casos en {m}", { m: mesLargo(meses[i]) })} valor=${nf(s.cases[i])} debajo=${html`${vsAnterior(s.cases[i], s.cases[i - 1], ant)} <span class="pill">${tc.txt}</span>`} extra=${html`<${Linea} vals=${s.cases.slice(0, i + 1)} color=${color} />`} />
    <${Kpi} etiqueta=${t("Horas en casos (LOE)")} valor=${nf(hrs(s.loe[i]))} unidad="h" debajo=${html`${vsAnterior(s.loe[i], s.loe[i - 1], ant)} <span class="pill">${tl.txt}</span>`} extra=${html`<${Linea} vals=${s.loe.slice(0, i + 1)} color=${color} />`} />
    <${Kpi} etiqueta=${t("Errores reales en QA")} valor=${e == null ? "—" : nf(e, 1)} unidad=${e == null ? "" : "%"} debajo=${t("{e} de {n} revisiones", { e: nf(s.qaErr[i]), n: nf(s.qaTot[i]) })} extra=${qaPill && html`<div class="rd-kpi-x">${qaPill}</div>`} />
    ${cuarto}
  </div>`;
}

function Capacity({ ps, meses, i, color }) {
  const proj = {};
  ps.forEach((p) => Object.entries(p.proj[i]).forEach(([k, v]) => (proj[k] = (proj[k] || 0) + hrs(v.loe))));
  const filas = Object.entries(proj).filter((f) => f[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const conB = ps.filter((p) => p.bamboo[i]);
  const enCasos = sum(conB.map((p) => hrs(p.loe[i]))), enBamboo = sum(conB.map((p) => p.bamboo[i].h));
  return html`<section class="rd-card"><h2>${t("Capacity por proyecto")}</h2><p class="rd-sub">${t("Horas de casos en {m}, por proyecto", { m: mesLargo(meses[i]) })}</p>
    ${conB.length ? html`<p class="small rd-cruce">${t("{a} h en casos de {b} h registradas en Bamboo ({p}%).", { a: nf(enCasos), b: nf(enBamboo), p: nf(enBamboo ? (enCasos / enBamboo) * 100 : 0) })} <span class="muted">${t("Lo demás: reuniones, soporte, otros proyectos.")}</span></p>`
      : html`<p class="small muted rd-cruce">${t("Sin horas de Bamboo para este mes.")}</p>`}
    ${filas.length ? html`<${BarrasH} filas=${filas} color=${color} fmt=${(v) => nf(v) + " h"} />` : html`<p class="small muted">${t("Sin horas de casos en este mes.")}</p>`}
  </section>`;
}

// Frase del mes (de la opción C). `tu`: la persona se lee a sí misma.
function fraseDelMes(s, meses, i, tu, nombre) {
  const c = s.cases[i], cb = s.cases[i - 1], e = tasaError(s, i), eb = tasaError(s, i - 1);
  const partes = [tu ? t("En {m} cerraste {n} casos", { m: mesNombre(meses[i]), n: nf(c) }) : t("En {m}, {q} cerró {n} casos", { m: mesNombre(meses[i]), q: nombre, n: nf(c) })];
  if (cb) {
    const d = Math.round(((c - cb) / cb) * 100);
    partes[0] += d === 0 ? t(", igual que en {m}.", { m: mesNombre(meses[i - 1]) }) : d > 0 ? t(", {p}% más que en {m}.", { p: d, m: mesNombre(meses[i - 1]) }) : t(", {p}% menos que en {m}.", { p: -d, m: mesNombre(meses[i - 1]) });
  } else partes[0] += ".";
  partes.push(tu ? t("Dedicaste {h} horas a casos.", { h: nf(hrs(s.loe[i])) }) : t("Dedicó {h} horas a casos.", { h: nf(hrs(s.loe[i])) }));
  if (e != null) partes.push(eb == null ? t("Los errores reales en QA fueron {e}%.", { e: nf(e, 1) })
    : e < eb - 0.3 ? t("Los errores reales en QA bajaron a {e}% (antes {b}%).", { e: nf(e, 1), b: nf(eb, 1) })
    : e > eb + 0.3 ? t("Los errores reales en QA subieron a {e}% (antes {b}%).", { e: nf(e, 1), b: nf(eb, 1) })
    : t("Los errores reales en QA se mantuvieron en {e}%.", { e: nf(e, 1) }));
  const tr = tendencia(s.cases, i).k;
  if (tr) partes.push({ sube: t("En los últimos tres meses, el volumen sube."), baja: t("En los últimos tres meses, el volumen baja."), estable: t("En los últimos tres meses, el volumen se mantiene.") }[tr]);
  if (s.kudos[i]) partes.push(tu ? t("Recibiste {n} kudos.", { n: s.kudos[i] }) : t("Recibió {n} kudos.", { n: s.kudos[i] }));
  return partes.join(" ");
}

const Migas = ({ partes }) => html`<nav class="rd-migas" aria-label=${t("Ruta")}>${partes.map(([txt, href], i) => html`${i > 0 && " › "}${href ? html`<a href=${href}>${txt}</a>` : html`<span>${txt}</span>`}`)}</nav>`;

function SinAcceso() { return html`<section class="page"><${Empty}>${t("No tienes acceso a esta sección.")}<//></section>`; }
function Cargando({ perf }) {
  if (!perf) return html`<main class="center"><${Busy} /></main>`;
  return html`<section class="page narrow"><h1>${t("Rendimiento")}</h1><${Empty}>${perf.available ? t("Todavía no hay datos de rendimiento.") : t("Los datos de rendimiento no están disponibles todavía.")}<//></section>`;
}

// ---------------------------------------------------------------------
// Nivel 1: Inicio (admin). Un líder entra directo a su grupo (o elige si lidera varios).
// ---------------------------------------------------------------------
// El dashboard (detalle, comparativas y subida de datos): admin y líderes. Allí cada líder ve solo su grupo.
function EnlaceDashboard() {
  const { isMember } = useApp();
  if (isMember || !PERF_DASHBOARD_URL) return null;
  return html`<a class="btn" href=${PERF_DASHBOARD_URL} target="_blank" rel="noopener">${t("Comparativas (vistas actuales)")} →</a>`;
}

export function RendimientoInicio() {
  const r = usarRendimiento();
  const { modelo, isAdmin, isMember, misGrupos, activos, miembros, perf, data, idx } = r;
  const [sel, setSel] = useState(N_MESES - 1);
  if (!modelo) return html`<${Cargando} perf=${perf} />`;
  if (isMember) {
    const mio = activos.find((p) => p.tc?.id === r.me?.person_id);
    return mio ? html`<${RendimientoPersona} id=${mio.id} />` : html`<${Cargando} perf=${{ available: true }} />`;
  }
  if (!isAdmin && misGrupos.length === 1) return html`<${RendimientoGrupo} id=${misGrupos[0].id} />`;
  const { meses } = modelo;
  const grupos = [...misGrupos].sort((a, b) => a.sort - b.sort).filter((g) => miembros(g.id).length);
  const todos = serie(activos);
  const ex = [...modelo.personas.values()].filter((p) => !p.active);
  const lideres = (gid) => data.group_leads.filter((l) => l.group_id === gid).sort((a, b) => b.is_primary - a.is_primary).map((l) => idx.person(l.person_id)?.full_name).filter(Boolean);
  return html`<section class="page">
    <header class="page-head"><div><h1>${t("Rendimiento")}</h1>
      <p class="muted">${isAdmin ? t("Todo el equipo, {m}.", { m: mesLargo(meses[sel]) }) : t("Tus grupos, {m}.", { m: mesLargo(meses[sel]) })}</p></div>
      <${EnlaceDashboard} /></header>
    <${SelectorMes} meses=${meses} sel=${sel} onSel=${setSel} />
    ${isAdmin && html`
      <${Kpis} s=${todos} meses=${meses} i=${sel} color="var(--primary)" cuarto=${html`<${Kpi} etiqueta=${t("Personas con casos")} valor=${nf(activos.filter((p) => p.cases[sel] > 0).length)} debajo=${t("en el mes")} />`} />
      <section class="rd-card"><h2>${t("Casos por mes, todo el equipo")}</h2><p class="rd-sub">${t("Últimos 12 meses. El mes resaltado es el elegido.")}</p>
        <${Barras} vals=${todos.cases} meses=${meses} sel=${sel} etiqueta=${t("Casos por mes, todo el equipo")} /></section>`}
    <h2 class="mt">${t("Grupos")}</h2>
    <div class="rd-gcards">${grupos.map((g) => {
      const mem = miembros(g.id), s = serie(mem), cc = mem.some((p) => p.conCasos);
      return html`<a class="rd-gcard" style=${`--c:${g.color}`} href=${"#/rendimiento-grupo/" + g.id} key=${g.id}><span class="rd-gcard-st"></span><span class="rd-gcard-in">
        <strong class="rd-gcard-h">${g.name}</strong>
        <span class="small muted">${lideres(g.id).join(" · ") || t("Reportan directo a Gus")} · ${mem.length === 1 ? t("1 persona") : t("{n} personas", { n: mem.length })}</span>
        ${cc ? html`<span class="rd-gcard-n"><span><b>${nf(s.cases[sel])}</b><span class="small muted">${t("casos")} · ${nf(hrs(s.loe[sel]))} h</span><span class="small">${vsAnterior(s.cases[sel], s.cases[sel - 1], meses[sel - 1])}</span></span><${Linea} vals=${s.cases.slice(0, sel + 1)} color=${g.color} ancho=${120} /></span>`
          : html`<span class="small muted rd-gcard-vacio">${t("Sin casos en el dashboard")}</span>`}
      </span></a>`;
    })}</div>
    ${isAdmin && ex.length > 0 && html`<section class="rd-card mt"><h2>${t("Ex-miembros (solo admin)")}</h2>
      <p class="rd-sub">${t("{n} personas inactivas, sin grupo. Cuentan en el histórico.", { n: ex.length })}</p>
      <div class="band-members">${ex.sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => html`<a class="chip dim" href=${"#/rendimiento-persona/" + p.id} key=${p.id}><${Avatar} person=${{ full_name: p.nombre }} size="sm" /><span class="chip-name">${p.nombre}</span><span class="small muted">${t("{n} casos en 12 meses", { n: nf(sum(p.cases)) })}</span></a>`)}</div></section>`}
  </section>`;
}

// ---------------------------------------------------------------------
// Nivel 2: Grupo (líder de ese grupo, o admin)
// ---------------------------------------------------------------------
export function RendimientoGrupo({ id }) {
  const r = usarRendimiento();
  const { modelo, isAdmin, idx, puedeGrupo, miembros, misGrupos, perf } = r;
  const [sel, setSel] = useState(N_MESES - 1);
  if (!modelo) return html`<${Cargando} perf=${perf} />`;
  const g = idx.group(id);
  if (!g || !puedeGrupo(id)) return html`<${SinAcceso} />`;
  const { meses } = modelo;
  const mem = miembros(id), s = serie(mem);
  const conversar = mem.filter((p) => p.conCasos).map((p) => ({ p, tr: tendencia(p.cases, sel).k, inc: p.inc[sel] })).filter((x) => x.tr === "baja" || x.inc);
  const reconocer = mem.filter((p) => p.kudos[sel]);
  const migas = isAdmin || misGrupos.length > 1 ? [[t("Rendimiento"), "#/rendimiento"], [g.name]] : [[g.name]];
  return html`<section class="page" style=${`--c:${g.color}`}>
    <${Migas} partes=${migas} />
    <header class="page-head"><div><h1>${g.name}</h1><p class="muted">${t("Totales del grupo. Sin rankings: la lista va por nombre y la tendencia de cada persona es contra su propio historial.")}</p></div>
      <${EnlaceDashboard} /></header>
    <${SelectorMes} meses=${meses} sel=${sel} onSel=${setSel} />
    <${Kpis} s=${s} meses=${meses} i=${sel} color=${g.color} cuarto=${html`<${Kpi} etiqueta=${t("Personas con casos")} valor=${nf(mem.filter((p) => p.cases[sel] > 0).length)} debajo=${t("de {n} en el grupo", { n: mem.length })} />`} />
    <div class="rd-grid2">
      <section class="rd-card"><h2>${t("Casos por mes")}</h2><p class="rd-sub">${t("Total del grupo")}</p><${Barras} vals=${s.cases} meses=${meses} sel=${sel} color=${g.color} ancho=${420} etiqueta=${t("Casos por mes")} /></section>
      <section class="rd-card"><h2>${t("Horas en casos por mes")}</h2><p class="rd-sub">${t("LOE en horas, total del grupo")}</p><${Barras} vals=${s.loe.map(hrs)} meses=${meses} sel=${sel} color=${g.color} fmt=${(v) => nf(v) + " h"} ancho=${420} etiqueta=${t("Horas en casos por mes")} /></section>
    </div>
    <div class="rd-lado">
      <section class="rd-card"><h2>${t("Personas")}</h2><p class="rd-sub">${t("{m}. Toca una persona para ver su perfil.", { m: mesLargo(meses[sel]) })}</p>
        <div class="rd-tabla-wrap"><table class="rd-tabla"><thead><tr><th>${t("Persona")}</th><th class="num">${t("Casos")}</th><th class="num">${t("Horas")}</th><th class="num">${t("Error QA")}</th><th>${t("Su tendencia")}</th></tr></thead>
        <tbody>${mem.map((p) => {
          const e = tasaError(p, sel), ir = () => (location.hash = "#/rendimiento-persona/" + p.id);
          return html`<tr key=${p.id} onClick=${ir} onKeyDown=${(ev) => ev.key === "Enter" && ir()} tabindex="0">
            <td><span class="rd-quien"><${Avatar} person=${p.tc} group=${g} size="sm" /> ${p.nombre}</span></td>
            ${p.conCasos ? html`<td class="num">${nf(p.cases[sel])}</td><td class="num">${nf(hrs(p.loe[sel]))} h</td><td class="num">${e == null ? "—" : nf(e, 1) + "%"}</td>
              <td><span class="rd-tend"><span class="pill">${tendencia(p.cases, sel).txt}</span><${Linea} vals=${p.cases.slice(0, sel + 1)} color=${g.color} ancho=${90} /></span></td>`
              : html`<td colspan="4" class="small muted">${t("Sin casos en el dashboard")}</td>`}
          </tr>`;
        })}</tbody></table></div></section>
      <div class="stack">
        <section class="rd-card"><h2>${t("Para conversar")}</h2><p class="rd-sub">${t("Sale de la tendencia de cada persona contra sí misma y de las incidencias de Team Coach.")}</p>
          ${conversar.length ? html`<ul class="rd-lista">${conversar.map(({ p, tr, inc }) => html`<li key=${p.id}><${Avatar} person=${p.tc} group=${g} size="sm" /><span><a href=${"#/rendimiento-persona/" + p.id}><b>${p.nombre}</b></a>
              ${tr === "baja" && html` · ${t("su volumen viene bajando contra su propio historial")}`}${inc ? html` · ${inc === 1 ? t("1 incidencia este mes") : t("{n} incidencias este mes", { n: inc })}` : null}</span></li>`)}</ul>`
            : html`<p class="small muted">${t("Nada que destacar este mes.")}</p>`}
          ${reconocer.length > 0 && html`<h3 class="mt">${t("Para reconocer")}</h3><ul class="rd-lista">${reconocer.map((p) => html`<li key=${p.id}><${Avatar} person=${p.tc} group=${g} size="sm" /><span><b>${p.nombre}</b> · ${t("{n} kudos", { n: p.kudos[sel] })}</span></li>`)}</ul>`}
        </section>
        <${Capacity} ps=${mem} meses=${meses} i=${sel} color=${g.color} />
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------
// Nivel 3: Persona ("Mi rendimiento" para la persona; su ficha para el líder y el admin)
// ---------------------------------------------------------------------
export function RendimientoPersona({ id }) {
  const r = usarRendimiento();
  const { modelo, isAdmin, isMember, idx, puedePersona, misGrupos, me, perf } = r;
  // Un ex-miembro abre en su último mes con casos; el resto, en el mes cerrado más reciente
  const [sel, setSel] = useState(() => { const p = modelo?.personas.get(id); const u = p && !p.active ? p.cases.findLastIndex((n) => n > 0) : -1; return u > 0 ? u : N_MESES - 1; });
  if (!modelo) return html`<${Cargando} perf=${perf} />`;
  const p = modelo.personas.get(id);
  if (!puedePersona(p)) return html`<${SinAcceso} />`;
  const { meses } = modelo;
  const g = p.group_id ? idx.group(p.group_id) : null;
  const yo = p.tc?.id && p.tc.id === me?.person_id;
  const color = g?.color ?? "#64748b";
  const migas = isMember ? [] : [...(isAdmin || misGrupos.length > 1 ? [[t("Rendimiento"), "#/rendimiento"]] : []), ...(g ? [[g.name, "#/rendimiento-grupo/" + g.id]] : []), [p.nombre]];
  const cabeza = html`<header class="person-head"><${Avatar} person=${{ full_name: p.nombre }} group=${g} size="xl" />
    <div class="grow"><h1>${yo ? t("Mi rendimiento") : p.nombre}</h1>
      <p class="muted">${[yo ? p.nombre : p.tc?.title, g?.name, !p.active && t("Inactivo")].filter(Boolean).join(", ")}</p>
      ${yo && html`<p class="small muted">${t("Solo tus números: nadie más del equipo los ve, salvo tu líder y Gus.")}</p>`}</div></header>`;
  if (!p.conCasos) return html`<section class="page narrow">${migas.length > 0 && html`<${Migas} partes=${migas} />`}${cabeza}<div class="mt"><${Empty}>${t("No hay casos del dashboard para esta persona.")}<//></div></section>`;
  const proj = Object.entries(p.proj[sel]).map(([k, v]) => [k, v.casos]).filter((f) => f[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const b = p.bamboo[sel];
  const hechos = [
    ...p.reuniones.map((m) => ({ d: String(m.meeting_date), txt: t("Reunión {k}", { k: t(MEETING_KIND[m.kind] ?? "Otra") }), c: EV.reunion })),
    ...meses.flatMap((m, i) => [p.inc[i] ? { d: m, txt: p.inc[i] === 1 ? t("1 incidencia") : t("{n} incidencias", { n: p.inc[i] }), c: EV.incidencia } : null, p.kudos[i] ? { d: m, txt: t("{n} kudos", { n: p.kudos[i] }), c: EV.kudos } : null]).filter(Boolean),
  ].sort((a, b2) => b2.d.localeCompare(a.d)).slice(0, 8);
  return html`<section class="page person" style=${`--c:${color}`}>
    ${migas.length > 0 && html`<${Migas} partes=${migas} />`}
    ${cabeza}
    <div class="mt"><${SelectorMes} meses=${meses} sel=${sel} onSel=${setSel} /></div>
    <section class="rd-card rd-frase"><p>${fraseDelMes(p, meses, sel, yo, p.nombre.split(" ")[0])}</p></section>
    <${Kpis} s=${p} meses=${meses} i=${sel} color="var(--primary)" cuarto=${html`<${Kpi} etiqueta=${t("Incidencias y kudos")} valor=${nf(p.inc[sel])} debajo=${t("{n} kudos en el mes", { n: nf(p.kudos[sel]) })} />`} />
    <div class="rd-lado">
      <div class="stack">
        <section class="rd-card"><h2>${yo ? t("Mis casos por mes") : t("Casos por mes")}</h2><p class="rd-sub">${t("Los puntos marcan reuniones, incidencias y kudos de ese mes.")}</p>
          <${Barras} vals=${p.cases} meses=${meses} sel=${sel} eventos=${eventosDe(p, meses)} etiqueta=${t("Casos por mes")} /><${LeyendaEventos} /></section>
        <div class="rd-grid2 sin-margen">
          <section class="rd-card"><h2>${t("Horas en casos")}</h2><p class="rd-sub">${t("LOE por mes")}</p><${Barras} vals=${p.loe.map(hrs)} meses=${meses} sel=${sel} fmt=${(v) => nf(v, 1) + " h"} ancho=${320} etiqueta=${t("Horas en casos")} /></section>
          <section class="rd-card"><h2>${yo ? t("Cuándo trabajo") : t("Cuándo trabaja")}</h2><p class="rd-sub">${t("Casos por hora y día de la semana, últimos 3 meses")}</p><${Horario} p=${p} /></section>
          <section class="rd-card"><h2>${yo ? t("En qué trabajé") : t("En qué trabajó")}</h2><p class="rd-sub">${t("Casos por proyecto, {m}", { m: mesLargo(meses[sel]) })}</p>${proj.length ? html`<${BarrasH} filas=${proj} />` : html`<p class="small muted">${t("Sin casos en este mes.")}</p>`}</section>
          <section class="rd-card"><h2>${t("QA")}</h2><p class="rd-sub">${t("Errores reales por mes")}</p><${Barras} vals=${meses.map((_, i) => tasaError(p, i))} meses=${meses} sel=${sel} fmt=${(v) => nf(v, 1) + "%"} ancho=${320} etiqueta=${t("Errores reales en QA")} /></section>
        </div>
      </div>
      <section class="rd-card"><h2>${t("En Team Coach")}</h2><p class="rd-sub">${t("Lo que pasó alrededor de los números")}</p>
        ${b ? html`<p class="small">${t("{h} h registradas en Bamboo en {m} (esperadas: {e} h); {c} h fueron casos.", { h: nf(b.h), m: mesNombre(meses[sel]), e: nf(b.e), c: nf(hrs(p.loe[sel])) })}</p>`
          : html`<p class="small muted">${t("Sin horas de Bamboo para este mes.")}</p>`}
        <ul class="rd-hechos">${hechos.length ? hechos.map((x, i) => html`<li key=${i}><span class="small muted">${x.d.length > 7 ? x.d.slice(0, 10) : mesCorto(x.d)}</span><i class="dot" style=${`background:${x.c}`}></i><span>${x.txt}</span></li>`)
          : html`<li class="small muted">${t("Sin reuniones, incidencias ni kudos todavía.")}</li>`}</ul>
      </section>
    </div>
  </section>`;
}

// =====================================================================
//  Incidencias (Cambio 18)
//  · Manuales: el líder las anota en segundos (categoría, gravedad, nota).
//  · Automáticas: Bamboo, cada lunes 8:00, una por persona y semana.
//  · Nunca se borran: se anulan con motivo y se pueden reactivar (queda historial).
//  · Cambio 19: cada uno ve las suyas (solo lectura); las nuevas salen en la campanita.
//  · Cambio 22: kudos (mensajes positivos) en la misma sección; no cuentan para el umbral.
// =====================================================================
import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";
import { useApp, t, toast, Modal, Empty, PersonLink, PersonSelect, fmtDate, today, firstName, srv, getLang, useTx, txAhora, TxCat } from "./app.js";

const html = htm.bind(h);

export const CATEGORIAS = ["SLA", "Puntualidad", "Cliente", "Calidad", "Comunicación", "Proceso", "Otro"];
export const CAT_BAMBOO = "Bamboo (registro de horas)";
export const GRAVEDAD = { leve: "Leve", moderada: "Moderada", critica: "Crítica" };
export const CATEGORIAS_KUDOS = ["Cliente feliz", "Trabajo en equipo", "Calidad", "Iniciativa", "Ayudó a otros", "Logro", "Otro"];
export const esKudos = (i) => i?.kind === "kudos";
const mesDe = (d) => String(d).slice(0, 7);

export function umbral(bamboo) {
  const c = Object.fromEntries((bamboo?.rules?.config ?? []).map((r) => [r.key, r.value]));
  return Number(c.incident_threshold ?? 3) || 3;
}

/** Puede anotar sobre esta persona: Gus, o el líder (no sobre sí mismo ni sobre otros líderes). */
export const puedeAnotar = (ctx, pid) => !!pid && (ctx.isAdmin || (pid !== ctx.me?.person_id && !ctx.idx.isLead(pid)));

/** Nombre a mostrar: persona de Team Coach o, si la incidencia es de Bamboo sin enlace, el nombre de Bamboo. */
export function nombreDe(ctx, inc) {
  const p = inc.person_id && ctx.idx.person(inc.person_id);
  if (p) return p.full_name;
  return (ctx.bamboo?.employees ?? []).find((e) => e.bamboo_id === inc.bamboo_id)?.full_name ?? "—";
}

/** Es una incidencia mía (sobre mí). Las veo, pero no las anulo ni las edito. */
export function esMia(ctx, inc) {
  const pid = ctx.me?.person_id;
  if (!pid) return false;
  const bid = ctx.idx.person(pid)?.bamboo_id;
  return inc.person_id === pid || (!!bid && inc.bamboo_id === bid);
}

const SIETE_DIAS = 7 * 86400000;
/** Desde cuándo cuenta lo "nuevo" de una sección (si nunca la abrió: últimos 7 días). */
export function vistoDesde(ctx, kind) {
  const r = (ctx.seen ?? ctx.data.user_seen ?? []).find((x) => x.kind === kind);
  return r ? new Date(r.seen_at).getTime() : Date.now() - SIETE_DIAS;
}

/** Incidencias nuevas para mí: activas, creadas desde la última vez que abrí Incidencias y no anotadas por mí. */
export function nuevas(ctx, desde = vistoDesde(ctx, "incidents")) {
  const yo = ctx.session?.user?.id;
  return (ctx.data.incidents ?? []).filter((i) => !i.voided && i.created_by !== yo && new Date(i.created_at).getTime() > desde);
}

/** Conteo del mes (sin anuladas) por persona. */
export function conteoMes(incs, mes) {
  const m = new Map();
  for (const i of incs ?? []) if (!i.voided && !esKudos(i) && mesDe(i.occurred_on) === mes) {
    const k = i.person_id ?? "b:" + i.bamboo_id;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function SevPill({ s }) {
  return html`<span class=${"pill sev-" + s}>${t(GRAVEDAD[s] ?? s)}</span>`;
}

// ---------------------------------------------------------------------
// Anotar una incidencia (3 toques)
// ---------------------------------------------------------------------
export function KudosPill() {
  return html`<span class="pill kudos-pill"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>Kudos</span>`;
}

export function IncidentForm({ person, onClose, tipo = "incidencia" }) {
  const kudos = tipo === "kudos";
  const cats = kudos ? CATEGORIAS_KUDOS : CATEGORIAS;
  const ctx = useApp();
  const { api, reload } = ctx;
  const [pid, setPid] = useState(person?.id ?? "");
  const [cat, setCat] = useState("");
  const [otra, setOtra] = useState("");
  const [sev, setSev] = useState("leve");
  const [fecha, setFecha] = useState(today());
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const guardar = async (e) => {
    e.preventDefault();
    if (!pid) return toast(t("Elige a la persona."), "bad");
    const categoria = cat === "Otro" ? (otra.trim() || "Otro") : cat;
    if (!categoria) return toast(t("Elige una categoría."), "bad");
    setBusy(true);
    try {
      const fila = { person_id: pid, category: categoria, severity: kudos ? "leve" : sev, occurred_on: fecha, note: nota.trim() || null };
      if (kudos) fila.kind = "kudos";
      await api.insert("incidents", [fila]);
      toast(kudos ? t("Kudos registrados") : t("Incidencia registrada"));
      await reload(); onClose();
    } catch (x) { toast(x.message, "bad"); }
    setBusy(false);
  };
  const titulo = kudos ? (person ? t("Kudos para {n}", { n: firstName(person.full_name) }) : t("Nuevos kudos"))
    : (person ? t("Incidencia de {n}", { n: firstName(person.full_name) }) : t("Nueva incidencia"));
  return html`<${Modal} title=${titulo} onClose=${onClose}>
    <form class="stack" onSubmit=${guardar}>
      ${!person && html`<label>${t("Persona")}<${PersonSelect} value=${pid} onChange=${(v) => setPid(v ?? "")} allowEmpty=${t("Elige una persona")} only=${(p) => puedeAnotar(ctx, p.id)} /></label>`}
      <div><span class="lbl">${t("Categoría")}</span>
        <div class=${"inc-cats" + (kudos ? " kudos" : "")}>${cats.map((c) => html`<button type="button" class=${"chip-btn" + (cat === c ? " on" : "")} aria-pressed=${cat === c} onClick=${() => setCat(c)}>${t(c)}</button>`)}</div>
        ${cat === "Otro" && html`<input class="mt-s" value=${otra} onInput=${(e) => setOtra(e.target.value)} placeholder=${t("¿Cuál?")} />`}
      </div>
      <div class="row">
        ${!kudos && html`<div><span class="lbl">${t("Gravedad")}</span>
          <div class="seg">${Object.entries(GRAVEDAD).map(([k, v]) => html`<button type="button" class=${sev === k ? "on" : ""} aria-pressed=${sev === k} onClick=${() => setSev(k)}>${t(v)}</button>`)}</div></div>`}
        <label>${t("Fecha")}<input type="date" value=${fecha} onInput=${(e) => setFecha(e.target.value)} /></label>
      </div>
      <label>${kudos ? t("Mensaje (opcional)") : t("Nota (opcional)")}<input value=${nota} onInput=${(e) => setNota(e.target.value)} placeholder=${kudos ? t("Ej.: el cliente agradeció la entrega antes de tiempo") : t("Ej.: respondió al cliente sin revisar el caso")} /></label>
      ${kudos && html`<p class="small muted">${t("La persona lo ve en su espacio. Suma como fortaleza en la preparación de la 1:1.")}</p>`}
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class=${"primary" + (kudos ? " kudos-btn" : "")} disabled=${busy}>${kudos ? t("Dar kudos") : t("Registrar")}</button></div>
    </form>
  <//>`;
}

function Anular({ inc, onClose }) {
  const { api, reload } = useApp();
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const go2 = async (e) => {
    e.preventDefault();
    if (!motivo.trim()) return toast(t("Escribe el motivo."), "bad");
    setBusy(true);
    try { await api.update("incidents", inc.id, { voided: true, void_reason: motivo.trim() }); toast(t("Incidencia anulada")); reload(); onClose(); }
    catch (x) { toast(x.message, "bad"); }
    setBusy(false);
  };
  return html`<${Modal} title=${t("Anular incidencia")} onClose=${onClose}>
    <form class="stack" onSubmit=${go2}>
      <p class="muted small">${t("No se borra: queda anulada con el motivo, quién y cuándo. Puedes reactivarla después; queda en el historial.")}</p>
      <label>${t("Motivo")}<input value=${motivo} onInput=${(e) => setMotivo(e.target.value)} placeholder=${t("Ej.: el cliente pidió mover la entrega")} /></label>
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary" disabled=${busy}>${t("Anular")}</button></div>
    </form>
  <//>`;
}

async function reactivar(ctx, inc) {
  if (!confirm(t("¿Reactivar esta incidencia? Vuelve a contar y queda en el historial."))) return;
  try { await ctx.api.update("incidents", inc.id, { voided: false }); toast(t("Incidencia reactivada")); ctx.reload(); }
  catch (x) { toast(x.message, "bad"); }
}

const fechaHora = (ts) => (ts ? fmtDate(String(ts).slice(0, 10)) : "—");

export function IncidentRow({ inc, showPerson = true, nueva = false }) {
  const ctx = useApp();
  const [anular, setAnular] = useState(false);
  const [hist, setHist] = useState(false);
  const auto = inc.source === "bamboo";
  const mia = esMia(ctx, inc) && !ctx.isAdmin;
  const puedeReactivar = ctx.isAdmin || (!!inc.voided_by && inc.voided_by === ctx.session?.user?.id);
  const historial = Array.isArray(inc.history) ? inc.history : [];
  const kd = esKudos(inc);
  const nota = useTx(inc.note);
  const motivo = useTx(inc.void_reason);
  return html`<li class=${"inc" + (kd ? " kudos" : "") + (inc.voided ? " voided" : "") + (nueva ? " is-new" : "")}>
    <div class="inc-main">
      ${nueva && html`<span class="pill new-pill">${t("Nueva")}</span>`}
      <span class="small muted nowrap">${fmtDate(inc.occurred_on)}</span>
      ${showPerson && html`<strong>${inc.person_id ? html`<${PersonLink} id=${inc.person_id} />` : nombreDe(ctx, inc)}</strong>`}
      ${kd ? html`<${KudosPill} />` : ""}<span class="pill"><${TxCat} c=${inc.category} /></span>${!kd && html`<${SevPill} s=${inc.severity} />`}
      ${auto ? html`<span class="small muted">${t("Automática (Bamboo)")}</span>` : html`<span class="small muted">${t("por {p}", { p: inc.created_by_name ?? "—" })}</span>`}
    </div>
    ${(inc.detail || inc.note) && html`<p class="small">${srv(inc.detail) || ""}${inc.detail && inc.note ? " · " : ""}${nota || ""}</p>`}
    ${inc.voided && html`<p class="small inc-void">${t("Anulada por {p} ({d}): {m}", { p: inc.voided_by_name ?? "—", d: fechaHora(inc.voided_at), m: motivo })}</p>`}
    ${(!mia || historial.length > 0) && html`<div class="inc-acts">
      ${!mia && (inc.voided
        ? puedeReactivar && html`<button class="link small" onClick=${() => reactivar(ctx, inc)}>${t("Reactivar")}</button>`
        : html`<button class="link small late-t" onClick=${() => setAnular(true)}>${t("Anular")}</button>`)}
      ${historial.length > 0 && html`<button class="link small" aria-expanded=${hist} onClick=${() => setHist(!hist)}>${t("Historial ({n})", { n: historial.length })}</button>`}
    </div>`}
    ${hist && html`<ol class="inc-hist small muted">${historial.map((h) => html`<li>${fechaHora(h.cuando)} · ${h.accion === "anulada" ? t("Anulada por {p}: {m}", { p: h.por ?? "—", m: txAhora(h.motivo) ?? "" }) : t("Reactivada por {p}", { p: h.por ?? "—" })}</li>`)}</ol>`}
    ${anular && html`<${Anular} inc=${inc} onClose=${() => setAnular(false)} />`}
  </li>`;
}

// ---------------------------------------------------------------------
// Página Incidencias y kudos (Cambio 23): resumen del equipo por período,
// gráfico mes a mes e historial completo de cada persona.
// ---------------------------------------------------------------------
const ISO = (d) => d.toISOString().slice(0, 10);
const sumar = (s, n) => ISO(new Date(Date.parse(s + "T00:00:00Z") + n * 86400000));
const lunesDe = (s) => { const wd = (new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7; return sumar(s, -wd); };
const finMes = (ym) => { const [y, m] = ym.split("-").map(Number); return ISO(new Date(Date.UTC(y, m, 0))); };
const mesMas = (ym, n) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const MESES_C = { es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"], en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] };
const MESES_L = { es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"], en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] };
const lg = () => (getLang() === "en" ? "en" : "es");
const mesCorto = (ym) => `${MESES_C[lg()][Number(ym.slice(5, 7)) - 1]}${ym.slice(0, 4) !== today().slice(0, 4) ? " " + ym.slice(2, 4) : ""}`;
const mesLargo = (ym) => { const n = MESES_L[lg()][Number(ym.slice(5, 7)) - 1]; return n.charAt(0).toUpperCase() + n.slice(1) + " " + ym.slice(0, 4); };
const clave = (i) => i.person_id ?? "b:" + i.bamboo_id;

/** Rango del período elegido y el período anterior del mismo largo (para la tendencia). */
export function rangoPeriodo(periodo, mes, hoy = today()) {
  if (periodo === "semana") { const ini = lunesDe(hoy); return { ini, fin: hoy, pIni: sumar(ini, -7), pFin: sumar(hoy, -7) }; }
  if (periodo === "mes") {
    const ini = mes + "-01", esActual = mes === hoy.slice(0, 7), fin = esActual ? hoy : finMes(mes);
    const prev = mesMas(mes, -1), dia = Number(fin.slice(8, 10));
    const pFin = esActual ? `${prev}-${String(Math.min(dia, Number(finMes(prev).slice(8, 10)))).padStart(2, "0")}` : finMes(prev);
    return { ini, fin, pIni: prev + "-01", pFin };
  }
  if (periodo === "tres") { const ini = mesMas(hoy.slice(0, 7), -2) + "-01"; return { ini, fin: hoy, pIni: mesMas(hoy.slice(0, 7), -5) + "-01", pFin: sumar(ini, -1) }; }
  if (periodo === "anio") { const y = hoy.slice(0, 4), py = String(Number(y) - 1); return { ini: y + "-01-01", fin: hoy, pIni: py + "-01-01", pFin: py + hoy.slice(4) }; }
  return { ini: "0000-01-01", fin: hoy, pIni: null, pFin: null };
}

function Tendencia({ d }) {
  if (d === null) return html`<span class="muted">—</span>`;
  if (d === 0) return html`<span class="trend-eq" title=${t("Igual que el período anterior")}>= 0</span>`;
  return d > 0
    ? html`<span class="trend-up" title=${t("Más incidencias que el período anterior")}>▲ +${d}</span>`
    : html`<span class="trend-down" title=${t("Menos incidencias que el período anterior")}>▼ ${d}</span>`;
}

/** Barras agrupadas por mes (o semana): incidencias y kudos del equipo. */
function GraficoMeses({ cols, sel, onPick }) {
  const [hov, setHov] = useState(null);
  // Ancho real del contenedor: el gráfico ocupa todo el ancho y el texto no se achica
  const caja = useRef(null);
  const [ancho, setAncho] = useState(900);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(280, el.clientWidth));
    medir();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const max = Math.max(1, ...cols.map((c) => Math.max(c.inc, c.kud)));
  const pasos = max <= 4 ? max : 4;
  const tope = Math.ceil(max / pasos) * pasos;
  const H = 150, top = 14, base = top + H, gap = 2, izq = 30;
  const colW = Math.max(38, Math.min(140, (ancho - izq - 6) / Math.max(cols.length, 1)));
  const barW = Math.max(10, Math.min(26, Math.floor(colW * 0.26)));
  const W = izq + cols.length * colW + 6;
  const y = (v) => base - (v / tope) * H;
  const barra = (x, v, cls) => {
    if (!v) return null;
    const h = Math.max(base - y(v), 3), r = Math.min(4, h / 2);
    return html`<path class=${cls} d=${`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z`} />`;
  };
  const c = hov !== null ? cols[hov] : null;
  return html`<div class="chart-box">
    <div class="chart-legend small"><span><i class="sw-inc"></i>${t("Incidencias")}</span><span><i class="sw-kud"></i>${t("Kudos")}</span></div>
    <div class="chart-scroll" ref=${caja}>
      <svg class="chart" viewBox=${`0 0 ${W} ${base + 22}`} width=${W} height=${base + 22} role="img" aria-label=${t("Incidencias y kudos por mes")}>
        ${Array.from({ length: pasos + 1 }, (_, k) => { const v = (tope / pasos) * k; return html`<g key=${"g" + k}><line class="grid" x1=${izq} x2=${W} y1=${y(v)} y2=${y(v)} /><text class="ax" x=${izq - 6} y=${y(v) + 3} text-anchor="end">${v}</text></g>`; })}
        ${cols.map((col, i) => { const x0 = izq + i * colW + (colW - (barW * 2 + gap)) / 2; return html`<g key=${col.key} class=${"col" + (sel === col.key ? " on" : "") + (hov === i ? " hov" : "")}>
          ${sel === col.key && html`<rect class="col-sel" x=${izq + i * colW + 2} y=${top - 6} width=${colW - 4} height=${H + 6} rx="6" />`}
          ${barra(x0, col.inc, "b-inc")}${barra(x0 + barW + gap, col.kud, "b-kud")}
          <text class=${"ax" + (sel === col.key ? " ax-on" : "")} x=${izq + i * colW + colW / 2} y=${base + 15} text-anchor="middle">${col.label}</text>
          <rect class="hit" x=${izq + i * colW} y=${top - 6} width=${colW} height=${H + 30} onMouseEnter=${() => setHov(i)} onMouseLeave=${() => setHov(null)}
            onClick=${() => col.pick && onPick(col.pick)} style=${col.pick ? "cursor:pointer" : ""}><title>${`${col.title}: ${col.inc} · ${col.kud} kudos`}</title></rect>
        </g>`; })}
      </svg>
      ${c && html`<div class="chart-tip" style=${`left:${((izq + hov * colW + colW / 2) / W) * 100}%`}>
        <strong>${c.title}</strong><span><i class="sw-inc"></i>${c.inc === 1 ? t("1 incidencia") : t("{n} incidencias", { n: c.inc })}</span><span><i class="sw-kud"></i>${t("{n} kudos", { n: c.kud })}</span>
        ${c.pick && html`<span class="muted">${t("Clic para ver ese mes")}</span>`}</div>`}
    </div>
  </div>`;
}

/** Historial completo de una persona, agrupado por mes. */
function HistorialPersona({ k, nombre, incs, onClose, rango }) {
  const ctx = useApp();
  const [soloPeriodo, setSoloPeriodo] = useState(false);
  const [verAnuladas, setVerAnuladas] = useState(false);
  const suyas = incs.filter((i) => clave(i) === k).sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at).localeCompare(String(a.created_at)));
  const vis = suyas.filter((i) => (verAnuladas || !i.voided) && (!soloPeriodo || (i.occurred_on >= rango.ini && i.occurred_on <= rango.fin)));
  const act = suyas.filter((i) => !i.voided);
  const lim = umbral(ctx.bamboo);
  const porMes = new Map();
  for (const i of act.filter((i) => !esKudos(i))) porMes.set(mesDe(i.occurred_on), (porMes.get(mesDe(i.occurred_on)) ?? 0) + 1);
  const mesesSobre = [...porMes.values()].filter((n) => n >= lim).length;
  const grupos = [];
  for (const i of vis) { const m = mesDe(i.occurred_on); let g = grupos.find((x) => x.m === m); if (!g) grupos.push((g = { m, items: [] })); g.items.push(i); }
  const pid = suyas[0]?.person_id;
  return html`<section class="block hist-p" id="hist-persona">
    <div class="row between"><h2>${t("Historial de {n}", { n: nombre })}</h2>
      <div class="row">${pid && html`<a class="small" href=${"#/persona/" + pid}>${t("Ver perfil")} →</a>`}<button class="icon" aria-label=${t("Cerrar")} onClick=${onClose}>✕</button></div></div>
    <div class="pulse">
      <span class="pulse-item"><strong>${act.filter((i) => !esKudos(i)).length}</strong> ${t("incidencias en total")}</span>
      <span class="pulse-item kudos-pulse"><strong>${act.filter(esKudos).length}</strong> ${t("kudos en total")}</span>
      <span class=${"pulse-item" + (mesesSobre ? " alert" : "")}><strong>${mesesSobre}</strong> ${t("meses sobre el umbral ({n})", { n: lim })}</span>
      <span class="pulse-item"><strong>${act[act.length - 1] ? fmtDate(act[act.length - 1].occurred_on) : "—"}</strong> ${t("primer registro")}</span>
    </div>
    <div class="row hb-bar">
      <label class="check small"><input type="checkbox" checked=${soloPeriodo} onChange=${(e) => setSoloPeriodo(e.target.checked)} />${t("Solo el período elegido")}</label>
      <label class="check small"><input type="checkbox" checked=${verAnuladas} onChange=${(e) => setVerAnuladas(e.target.checked)} />${t("Ver anuladas")}</label>
    </div>
    ${grupos.length ? grupos.map((g) => { const ni = g.items.filter((i) => !i.voided && !esKudos(i)).length, nk = g.items.filter((i) => !i.voided && esKudos(i)).length;
      return html`<div class="hist-mes" key=${g.m}><h3 class="small-h">${mesLargo(g.m)} <span class="small muted">· ${ni === 1 ? t("1 incidencia") : t("{n} incidencias", { n: ni })} · ${t("{n} kudos", { n: nk })}</span>${ni >= lim && html` <span class="pill hb-bad">${t("Umbral")}</span>`}</h3>
        <ul class="inc-list">${g.items.map((i) => html`<${IncidentRow} inc=${i} key=${i.id} showPerson=${false} />`)}</ul></div>`; })
      : html`<${Empty}>${t("Sin registros en este período.")}<//>`}
  </section>`;
}

export function IncidenciasView() {
  const ctx = useApp();
  const { data, bamboo, isAdmin, idx } = ctx;
  const hoy = today();
  const [nueva, setNueva] = useState(null);   // "incidencia" | "kudos"
  const [periodo, setPeriodo] = useState(() => { try { return localStorage.getItem("tc-inc-periodo") || "mes"; } catch (_) { return "mes"; } });
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [quien, setQuien] = useState("");
  const [tipo, setTipo] = useState("todas");
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [limite, setLimite] = useState(60);
  const [desde] = useState(() => vistoDesde(ctx, "incidents"));
  useEffect(() => { if (!data.incidents_error) ctx.markSeen?.("incidents"); }, []);
  useEffect(() => { if (quien) setTimeout(() => document.getElementById("hist-persona")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }, [quien]);
  const setP = (p) => { setPeriodo(p); try { localStorage.setItem("tc-inc-periodo", p); } catch (_) {} };
  if (data.incidents_error) return html`<section class="page narrow"><h1>${t("Incidencias y kudos")}</h1><p class="warn mt">${isAdmin ? t("Falta correr 12_incidencias.sql en Supabase.") : t("Todavía no está disponible.")}</p></section>`;
  const nuevasIds = new Set(nuevas(ctx, desde).map((i) => i.id));
  const todasVis = data.incidents ?? [];
  const mias = isAdmin ? [] : todasVis.filter((i) => esMia(ctx, i));
  const incs = isAdmin ? todasVis : todasVis.filter((i) => !esMia(ctx, i));
  const lim = umbral(bamboo);
  const r = rangoPeriodo(periodo, mes, hoy);
  const enP = (i, a, b) => i.occurred_on >= a && i.occurred_on <= b;
  const delP = incs.filter((i) => enP(i, r.ini, r.fin));
  const actP = delP.filter((i) => !i.voided);
  const prevP = r.pIni ? incs.filter((i) => !i.voided && enP(i, r.pIni, r.pFin)) : null;

  // Resumen por persona: toda mi gente (también quien no tiene registros) + quien tenga registros
  const nombreK = new Map();
  for (const i of incs) if (!nombreK.has(clave(i))) nombreK.set(clave(i), { nombre: nombreDe(ctx, i), pid: i.person_id });
  if (verTodos) for (const p of data.people) if (["activo", "pausado"].includes(p.status) && puedeAnotar(ctx, p.id) && !nombreK.has(p.id)) nombreK.set(p.id, { nombre: p.full_name, pid: p.id });
  const claves = verTodos ? [...nombreK.keys()] : [...new Set(actP.map(clave))];
  const filas = claves.map((k) => {
    const a = actP.filter((i) => clave(i) === k), ins = a.filter((i) => !esKudos(i));
    const porMes = new Map(); for (const i of ins) porMes.set(mesDe(i.occurred_on), (porMes.get(mesDe(i.occurred_on)) ?? 0) + 1);
    return { k, ...nombreK.get(k), n: ins.length, crit: ins.filter((i) => i.severity === "critica").length, auto: ins.filter((i) => i.source === "bamboo").length,
      kudos: a.filter(esKudos).length, mesesSobre: [...porMes.values()].filter((n) => n >= lim).length,
      d: prevP ? ins.length - prevP.filter((i) => clave(i) === k && !esKudos(i)).length : null };
  }).filter((f) => f.nombre).sort((a, b) => b.n - a.n || b.crit - a.crit || b.kudos - a.kudos || a.nombre.localeCompare(b.nombre));
  const sinReg = verTodos ? filas.filter((f) => !f.n && !f.kudos).length : 0;

  // Gráfico: meses (o semanas en "Esta semana")
  const mesesData = [...new Set(incs.map((i) => mesDe(i.occurred_on)))].sort();
  let cols;
  if (periodo === "semana") {
    cols = Array.from({ length: 8 }, (_, k) => { const ini = sumar(lunesDe(hoy), -7 * (7 - k)), fin = sumar(ini, 6);
      const xs = incs.filter((i) => !i.voided && enP(i, ini, fin));
      return { key: ini, label: fmtDate(ini).replace(/ \d{4}$/, ""), title: `${fmtDate(ini)} – ${fmtDate(fin)}`, inc: xs.filter((i) => !esKudos(i)).length, kud: xs.filter(esKudos).length }; });
  } else {
    const fin = periodo === "mes" ? (mes > hoy.slice(0, 7) ? hoy.slice(0, 7) : mes) : hoy.slice(0, 7);
    const ini = periodo === "todo" ? (mesesData[0] && mesesData[0] < mesMas(fin, -23) ? mesMas(fin, -23) : (mesesData[0] ?? fin))
      : periodo === "anio" ? hoy.slice(0, 4) + "-01" : mesMas(fin, -5);
    cols = [];
    for (let m = ini; m <= fin; m = mesMas(m, 1)) {
      const xs = incs.filter((i) => !i.voided && mesDe(i.occurred_on) === m);
      cols.push({ key: m, label: mesCorto(m), title: mesLargo(m), pick: m, inc: xs.filter((i) => !esKudos(i)).length, kud: xs.filter(esKudos).length });
    }
  }
  const selCol = periodo === "mes" ? mes : periodo === "semana" ? lunesDe(hoy) : null;

  const lista = delP.filter((i) => (verAnuladas || !i.voided)
    && (tipo === "todas" || (tipo === "auto" ? i.source === "bamboo" : tipo === "kudos" ? esKudos(i) : !esKudos(i))))
    .sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at).localeCompare(String(a.created_at)));
  const meses = [...new Set([hoy.slice(0, 7), ...mesesData])].sort().reverse();
  const sobre = periodo === "mes" ? filas.filter((f) => f.n >= lim).length : filas.filter((f) => f.mesesSobre > 0).length;
  const nInc = actP.filter((i) => !esKudos(i)).length, nKud = actP.filter(esKudos).length;
  const pInc = prevP ? prevP.filter((i) => !esKudos(i)).length : null, pKud = prevP ? prevP.filter(esKudos).length : null;
  const vsTxt = { semana: t("vs semana anterior"), mes: t("vs mismo tramo del mes anterior"), tres: t("vs 3 meses anteriores"), anio: t("vs mismo tramo del año anterior") }[periodo];
  const delta = (a, b) => (b === null ? "" : a - b > 0 ? ` (+${a - b})` : a - b < 0 ? ` (${a - b})` : " (=)");
  const quienF = quien ? filas.find((f) => f.k === quien) ?? { k: quien, ...nombreK.get(quien) } : null;

  return html`<section class="page inc-page">
    <header class="page-head"><div><h1>${t("Incidencias y kudos")}</h1>
      <p class="muted">${t("Registro para el coaching: lo que hay que mejorar y también lo que se hizo bien. Las incidencias de Bamboo se crean solas cada lunes a las 8:00. Nada se borra: se anula con motivo.")}</p></div>
      <div class="row"><button class="kudos-btn" onClick=${() => setNueva("kudos")}>+ ${t("Kudos")}</button><button class="primary" onClick=${() => setNueva("incidencia")}>+ ${t("Incidencia")}</button></div></header>
    ${nuevasIds.size > 0 && html`<p class="inc-new-note small"><span class="pill new-pill">${t("Nueva")}</span> ${nuevasIds.size === 1 ? t("1 registro nuevo desde tu última visita.") : t("{n} registros nuevos desde tu última visita.", { n: nuevasIds.size })}</p>`}

    <div class="row hb-bar periodo-bar">
      <div class="seg" role="tablist" aria-label=${t("Período")}>${[["semana", t("Esta semana")], ["mes", t("Mes")], ["tres", t("Últimos 3 meses")], ["anio", t("Este año")], ["todo", t("Todo el historial")]].map(([k, l]) =>
        html`<button role="tab" aria-selected=${periodo === k} class=${periodo === k ? "on" : ""} onClick=${() => setP(k)}>${l}</button>`)}</div>
      ${periodo === "mes" && html`<select class="mini" value=${mes} onChange=${(e) => setMes(e.target.value)} aria-label=${t("Mes")}>${meses.map((m) => html`<option value=${m}>${mesLargo(m)}</option>`)}</select>`}
      <span class="small muted">${periodo === "todo" ? t("Desde el primer registro") : `${fmtDate(r.ini)} – ${fmtDate(r.fin)}`}</span>
    </div>

    <div class="pulse">
      <span class="pulse-item"><strong>${nInc}</strong> ${nInc === 1 ? t("incidencia") : t("incidencias")}${pInc !== null ? html` <span class="small muted" title=${vsTxt}>${delta(nInc, pInc)}</span>` : ""}</span>
      <span class="pulse-item kudos-pulse"><strong>${nKud}</strong> ${t("kudos")}${pKud !== null ? html` <span class="small muted" title=${vsTxt}>${delta(nKud, pKud)}</span>` : ""}</span>
      ${(() => { const nc = actP.filter((i) => !esKudos(i) && i.severity === "critica").length; return html`<span class="pulse-item"><strong>${nc}</strong> ${nc === 1 ? t("crítica") : t("críticas")}</span>`; })()}
      <span class=${"pulse-item" + (sobre ? " alert" : "")}><strong>${sobre}</strong> ${periodo === "mes" ? (sobre === 1 ? t("persona con {n} o más (umbral)", { n: lim }) : t("personas con {n} o más (umbral)", { n: lim })) : (sobre === 1 ? t("persona pasó el umbral algún mes") : t("personas que pasaron el umbral algún mes"))}</span>
    </div>

    <${GraficoMeses} cols=${cols} sel=${selCol} onPick=${(m) => { setMes(m); setP("mes"); }} />

    <div class="row between mt"><h2>${t("Resumen del equipo")} <span class="small muted">${vsTxt ? "· " + t("tendencia {v}", { v: vsTxt }) : ""}</span></h2>
      <label class="check small"><input type="checkbox" checked=${verTodos} onChange=${(e) => setVerTodos(e.target.checked)} />${t("Mostrar a todo el equipo (también sin registros)")}</label></div>
    ${filas.length ? html`<div class="tbl-scroll"><table class="tbl inc-sum"><thead><tr><th>${t("Persona")}</th><th class="right">${t("Incidencias")}</th>${periodo !== "todo" && html`<th class="right">${t("Tendencia")}</th>`}<th class="right">${t("Críticas")}</th><th class="right">${t("Bamboo")}</th><th class="right">${t("Kudos")}</th><th></th></tr></thead>
      <tbody>${filas.map((f) => html`<tr key=${f.k} class=${(quien === f.k ? "on" : "") + (!f.n && !f.kudos ? " cero" : "")} onClick=${() => setQuien(quien === f.k ? "" : f.k)}>
        <td>${f.nombre}${periodo === "mes" ? f.n >= lim && html` <span class="pill hb-bad">${t("Umbral: hablar con la persona")}</span>` : f.mesesSobre > 0 && html` <span class="pill hb-warn">${f.mesesSobre === 1 ? t("1 mes sobre el umbral") : t("{n} meses sobre el umbral", { n: f.mesesSobre })}</span>`}</td>
        <td class="right"><b>${f.n || "—"}</b></td>${periodo !== "todo" && html`<td class="right"><${Tendencia} d=${f.d} /></td>`}<td class="right">${f.crit || "—"}</td><td class="right">${f.auto || "—"}</td>
        <td class="right kudos-t">${f.kudos ? "★ " + f.kudos : "—"}</td>
        <td class="right"><button class="link small" onClick=${(e) => { e.stopPropagation(); setQuien(f.k); }}>${t("Historial")}</button></td></tr>`)}</tbody></table></div>
      ${sinReg > 0 && html`<p class="small muted">${t("{n} personas sin registros en este período.", { n: sinReg })}</p>`}`
      : html`<${Empty}>${t("No hay registros en este período.")}<//>`}

    ${quienF ? html`<${HistorialPersona} k=${quienF.k} nombre=${quienF.nombre ?? "—"} incs=${incs} rango=${r} onClose=${() => setQuien("")} />`
      : html`<section class="mt">
        <div class="row between"><h2>${t("Registros del período")}</h2>
          <div class="row"><div class="seg">${[["todas", t("Todas")], ["manual", t("Incidencias")], ["kudos", t("Kudos")], ["auto", t("Bamboo")]].map(([k, l]) => html`<button class=${tipo === k ? "on" : ""} aria-pressed=${tipo === k} onClick=${() => setTipo(k)}>${l}</button>`)}</div>
          <label class="check small"><input type="checkbox" checked=${verAnuladas} onChange=${(e) => setVerAnuladas(e.target.checked)} />${t("Ver anuladas ({n})", { n: delP.filter((i) => i.voided).length })}</label></div></div>
        ${lista.length ? html`<ul class="inc-list">${lista.slice(0, limite).map((i) => html`<${IncidentRow} inc=${i} key=${i.id} nueva=${nuevasIds.has(i.id)} />`)}</ul>
          ${lista.length > limite && html`<button class="link small" onClick=${() => setLimite(limite + 60)}>${t("Ver más ({n} restantes)", { n: lista.length - limite })}</button>`}`
          : html`<${Empty}>${t("No hay registros en este período.")}<//>`}
      </section>`}

    ${mias.length > 0 && html`<section class="block mt inc-mias">
      <h2>${t("Mis incidencias y kudos")} <span class="small muted">· ${t("solo lectura")}</span></h2>
      <p class="muted small">${t("Las registraron sobre ti. Si algo no está bien, háblalo con tu líder o con Gus.")}</p>
      <ul class="inc-list">${mias.filter((i) => verAnuladas || !i.voided).slice(0, 30).map((i) => html`<${IncidentRow} inc=${i} key=${i.id} showPerson=${false} nueva=${nuevasIds.has(i.id)} />`)}</ul>
    </section>`}
    ${nueva && html`<${IncidentForm} tipo=${nueva} onClose=${() => setNueva(null)} />`}
  </section>`;
}

// ---------------------------------------------------------------------
// Bloque en el perfil
// ---------------------------------------------------------------------
export function IncidenciasPersona({ person }) {
  const ctx = useApp();
  const { data, bamboo } = ctx;
  const [nueva, setNueva] = useState(null);
  const [todas, setTodas] = useState(false);
  if (data.incidents_error || !puedeAnotar(ctx, person.id) && !(data.incidents ?? []).some((i) => i.person_id === person.id)) return null;
  const mias = (data.incidents ?? []).filter((i) => i.person_id === person.id || (person.bamboo_id && i.bamboo_id === person.bamboo_id));
  const mes = today().slice(0, 7);
  const delMes = mias.filter((i) => !i.voided && mesDe(i.occurred_on) === mes);
  const n = delMes.filter((i) => !esKudos(i)).length;
  const k = delMes.filter(esKudos).length;
  const lim = umbral(bamboo);
  const lista = mias.filter((i) => todas || !i.voided).slice(0, todas ? 50 : 5);
  return html`<section class="block inc-person">
    <div class="row between"><h2>${t("Incidencias y kudos")} <span class="small muted">· ${t("{n} incidencias y {k} kudos este mes", { n, k })}</span>${n >= lim && person.id !== ctx.me?.person_id && html` <span class="pill hb-bad">${t("Umbral: hablar con la persona")}</span>`}</h2>
      ${puedeAnotar(ctx, person.id) && html`<div class="row"><button class="kudos-btn" onClick=${() => setNueva("kudos")}>+ ${t("Kudos")}</button><button onClick=${() => setNueva("incidencia")}>+ ${t("Incidencia")}</button></div>`}</div>
    ${lista.length ? html`<ul class="inc-list">${lista.map((i) => html`<${IncidentRow} inc=${i} showPerson=${false} key=${i.id} />`)}</ul>` : html`<${Empty}>${t("Sin registros todavía.")}<//>`}
    ${mias.length > 5 || mias.some((i) => i.voided) ? html`<button class="link small" onClick=${() => setTodas(!todas)}>${todas ? t("Ver menos") : t("Ver todas, incluidas las anuladas")}</button>` : ""}
    ${nueva && html`<${IncidentForm} person=${person} tipo=${nueva} onClose=${() => setNueva(null)} />`}
  </section>`;
}

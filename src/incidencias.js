// =====================================================================
//  Incidencias (Cambio 18)
//  · Manuales: el líder las anota en segundos (categoría, gravedad, nota).
//  · Automáticas: Bamboo, cada lunes 8:00, una por persona y semana.
//  · Nunca se borran: se anulan con motivo y se pueden reactivar (queda historial).
//  · Cambio 19: cada uno ve las suyas (solo lectura); las nuevas salen en la campanita.
// =====================================================================
import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";
import { useApp, t, toast, Modal, Empty, PersonLink, PersonSelect, fmtDate, today, firstName } from "./app.js";

const html = htm.bind(h);

export const CATEGORIAS = ["SLA", "Puntualidad", "Cliente", "Calidad", "Comunicación", "Proceso", "Otro"];
export const CAT_BAMBOO = "Bamboo (registro de horas)";
export const GRAVEDAD = { leve: "Leve", moderada: "Moderada", critica: "Crítica" };
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
  for (const i of incs ?? []) if (!i.voided && mesDe(i.occurred_on) === mes) {
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
export function IncidentForm({ person, onClose }) {
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
      await api.insert("incidents", [{ person_id: pid, category: categoria, severity: sev, occurred_on: fecha, note: nota.trim() || null }]);
      toast(t("Incidencia registrada"));
      await reload(); onClose();
    } catch (x) { toast(x.message, "bad"); }
    setBusy(false);
  };
  return html`<${Modal} title=${person ? t("Incidencia de {n}", { n: firstName(person.full_name) }) : t("Nueva incidencia")} onClose=${onClose}>
    <form class="stack" onSubmit=${guardar}>
      ${!person && html`<label>${t("Persona")}<${PersonSelect} value=${pid} onChange=${(v) => setPid(v ?? "")} allowEmpty=${t("Elige una persona")} only=${(p) => puedeAnotar(ctx, p.id)} /></label>`}
      <div><span class="lbl">${t("Categoría")}</span>
        <div class="inc-cats">${CATEGORIAS.map((c) => html`<button type="button" class=${"chip-btn" + (cat === c ? " on" : "")} aria-pressed=${cat === c} onClick=${() => setCat(c)}>${t(c)}</button>`)}</div>
        ${cat === "Otro" && html`<input class="mt-s" value=${otra} onInput=${(e) => setOtra(e.target.value)} placeholder=${t("¿Cuál?")} />`}
      </div>
      <div class="row">
        <div><span class="lbl">${t("Gravedad")}</span>
          <div class="seg">${Object.entries(GRAVEDAD).map(([k, v]) => html`<button type="button" class=${sev === k ? "on" : ""} aria-pressed=${sev === k} onClick=${() => setSev(k)}>${t(v)}</button>`)}</div></div>
        <label>${t("Fecha")}<input type="date" value=${fecha} onInput=${(e) => setFecha(e.target.value)} /></label>
      </div>
      <label>${t("Nota (opcional)")}<input value=${nota} onInput=${(e) => setNota(e.target.value)} placeholder=${t("Ej.: respondió al cliente sin revisar el caso")} /></label>
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary" disabled=${busy}>${t("Registrar")}</button></div>
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
  return html`<li class=${"inc" + (inc.voided ? " voided" : "") + (nueva ? " is-new" : "")}>
    <div class="inc-main">
      ${nueva && html`<span class="pill new-pill">${t("Nueva")}</span>`}
      <span class="small muted nowrap">${fmtDate(inc.occurred_on)}</span>
      ${showPerson && html`<strong>${inc.person_id ? html`<${PersonLink} id=${inc.person_id} />` : nombreDe(ctx, inc)}</strong>`}
      <span class="pill">${t(inc.category)}</span><${SevPill} s=${inc.severity} />
      ${auto ? html`<span class="small muted">${t("Automática (Bamboo)")}</span>` : html`<span class="small muted">${t("por {p}", { p: inc.created_by_name ?? "—" })}</span>`}
    </div>
    ${(inc.detail || inc.note) && html`<p class="small">${inc.detail || ""}${inc.detail && inc.note ? " · " : ""}${inc.note || ""}</p>`}
    ${inc.voided && html`<p class="small inc-void">${t("Anulada por {p} ({d}): {m}", { p: inc.voided_by_name ?? "—", d: fechaHora(inc.voided_at), m: inc.void_reason })}</p>`}
    ${(!mia || historial.length > 0) && html`<div class="inc-acts">
      ${!mia && (inc.voided
        ? puedeReactivar && html`<button class="link small" onClick=${() => reactivar(ctx, inc)}>${t("Reactivar")}</button>`
        : html`<button class="link small late-t" onClick=${() => setAnular(true)}>${t("Anular")}</button>`)}
      ${historial.length > 0 && html`<button class="link small" aria-expanded=${hist} onClick=${() => setHist(!hist)}>${t("Historial ({n})", { n: historial.length })}</button>`}
    </div>`}
    ${hist && html`<ol class="inc-hist small muted">${historial.map((h) => html`<li>${fechaHora(h.cuando)} · ${h.accion === "anulada" ? t("Anulada por {p}: {m}", { p: h.por ?? "—", m: h.motivo ?? "" }) : t("Reactivada por {p}", { p: h.por ?? "—" })}</li>`)}</ol>`}
    ${anular && html`<${Anular} inc=${inc} onClose=${() => setAnular(false)} />`}
  </li>`;
}

// ---------------------------------------------------------------------
// Página Incidencias
// ---------------------------------------------------------------------
export function IncidenciasView() {
  const ctx = useApp();
  const { data, bamboo, isAdmin } = ctx;
  const [nueva, setNueva] = useState(false);
  const [mes, setMes] = useState(today().slice(0, 7));
  const [quien, setQuien] = useState("");
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [soloAuto, setSoloAuto] = useState("todas");
  // Lo nuevo se calcula con el "visto" de cuando entré; al entrar queda todo como visto.
  const [desde] = useState(() => vistoDesde(ctx, "incidents"));
  const nuevasIds = new Set(nuevas(ctx, desde).map((i) => i.id));
  useEffect(() => { if (!data.incidents_error) ctx.markSeen?.("incidents"); }, []);
  const todasVis = data.incidents ?? [];
  const mias = isAdmin ? [] : todasVis.filter((i) => esMia(ctx, i));
  const incs = isAdmin ? todasVis : todasVis.filter((i) => !esMia(ctx, i));
  if (data.incidents_error) return html`<section class="page narrow"><h1>${t("Incidencias")}</h1><p class="warn mt">${isAdmin ? t("Falta correr 12_incidencias.sql en Supabase.") : t("Todavía no está disponible.")}</p></section>`;
  const lim = umbral(bamboo);
  const delMes = incs.filter((i) => mesDe(i.occurred_on) === mes);
  const filtradas = delMes.filter((i) => (verAnuladas || !i.voided) && (!quien || (i.person_id ?? "b:" + i.bamboo_id) === quien)
    && (soloAuto === "todas" || (soloAuto === "auto" ? i.source === "bamboo" : i.source === "manual")));
  const conteo = conteoMes(incs, mes);
  const resumen = [...conteo.entries()].map(([k, n]) => {
    const ej = incs.find((i) => (i.person_id ?? "b:" + i.bamboo_id) === k);
    const act = delMes.filter((i) => !i.voided && (i.person_id ?? "b:" + i.bamboo_id) === k);
    return { k, n, nombre: nombreDe(ctx, ej), pid: ej.person_id, crit: act.filter((i) => i.severity === "critica").length, auto: act.filter((i) => i.source === "bamboo").length };
  }).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
  const meses = [...new Set([today().slice(0, 7), ...incs.map((i) => mesDe(i.occurred_on))])].sort().reverse();
  const anuladas = delMes.filter((i) => i.voided).length;
  const sobre = resumen.filter((r) => r.n >= lim);
  return html`<section class="page">
    <header class="page-head"><div><h1>${t("Incidencias")}</h1>
      <p class="muted">${t("Registro para el coaching: las de Bamboo se crean solas cada lunes a las 8:00; las demás las anota el líder. No se borran: se anulan con motivo.")}</p></div>
      <button class="primary" onClick=${() => setNueva(true)}>+ ${t("Incidencia")}</button></header>
    ${nuevasIds.size > 0 && html`<p class="inc-new-note small"><span class="pill new-pill">${t("Nueva")}</span> ${nuevasIds.size === 1 ? t("1 incidencia nueva desde tu última visita.") : t("{n} incidencias nuevas desde tu última visita.", { n: nuevasIds.size })}</p>`}
    <div class="row hb-bar">
      <select class="mini" value=${mes} onChange=${(e) => setMes(e.target.value)} aria-label=${t("Mes")}>${meses.map((m) => html`<option value=${m}>${m}</option>`)}</select>
      <div class="seg">${[["todas", t("Todas")], ["manual", t("Manuales")], ["auto", t("Bamboo")]].map(([k, l]) => html`<button class=${soloAuto === k ? "on" : ""} onClick=${() => setSoloAuto(k)}>${l}</button>`)}</div>
      <label class="check small"><input type="checkbox" checked=${verAnuladas} onChange=${(e) => setVerAnuladas(e.target.checked)} />${t("Ver anuladas ({n})", { n: anuladas })}</label>
    </div>
    <div class="pulse">
      <span class="pulse-item"><strong>${delMes.filter((i) => !i.voided).length}</strong> ${t("incidencias en el mes")}</span>
      <span class=${"pulse-item" + (sobre.length ? " alert" : "")}><strong>${sobre.length}</strong> ${t("personas con {n} o más (umbral)", { n: lim })}</span>
      <span class="pulse-item"><strong>${delMes.filter((i) => !i.voided && i.severity === "critica").length}</strong> ${t("críticas")}</span>
      <span class="pulse-item"><strong>${anuladas}</strong> ${t("anuladas")}</span>
    </div>
    ${resumen.length > 0 && html`<table class="tbl inc-sum"><thead><tr><th>${t("Persona")}</th><th class="right">${t("En el mes")}</th><th class="right">${t("Críticas")}</th><th class="right">${t("Bamboo")}</th><th></th></tr></thead>
      <tbody>${resumen.map((r) => html`<tr key=${r.k} class=${quien === r.k ? "on" : ""} onClick=${() => setQuien(quien === r.k ? "" : r.k)}>
        <td>${r.nombre}${r.n >= lim && html` <span class="pill hb-bad">${t("Umbral: hablar con la persona")}</span>`}</td>
        <td class="right"><b>${r.n}</b></td><td class="right">${r.crit || "—"}</td><td class="right">${r.auto || "—"}</td>
        <td class="right">${r.pid && puedeAnotar(ctx, r.pid) && html`<button class="link small" onClick=${(e) => { e.stopPropagation(); setQuien(r.k); }}>${t("Ver")}</button>`}</td></tr>`)}</tbody></table>`}
    <h2 class="mt">${quien ? t("Incidencias de {n}", { n: resumen.find((r) => r.k === quien)?.nombre ?? "" }) : t("Todas las del mes")}${quien && html` <button class="link small" onClick=${() => setQuien("")}>${t("Ver todas")}</button>`}</h2>
    ${filtradas.length ? html`<ul class="inc-list">${filtradas.map((i) => html`<${IncidentRow} inc=${i} key=${i.id} nueva=${nuevasIds.has(i.id)} />`)}</ul>` : html`<${Empty}>${t("No hay incidencias en este mes.")}<//>`}
    ${mias.length > 0 && html`<section class="block mt inc-mias">
      <h2>${t("Mis incidencias")} <span class="small muted">· ${t("solo lectura")}</span></h2>
      <p class="muted small">${t("Las registraron sobre ti. Si algo no está bien, háblalo con tu líder o con Gus.")}</p>
      <ul class="inc-list">${mias.filter((i) => verAnuladas || !i.voided).slice(0, 30).map((i) => html`<${IncidentRow} inc=${i} key=${i.id} showPerson=${false} nueva=${nuevasIds.has(i.id)} />`)}</ul>
    </section>`}
    ${nueva && html`<${IncidentForm} onClose=${() => setNueva(false)} />`}
  </section>`;
}

// ---------------------------------------------------------------------
// Bloque en el perfil
// ---------------------------------------------------------------------
export function IncidenciasPersona({ person }) {
  const ctx = useApp();
  const { data, bamboo } = ctx;
  const [nueva, setNueva] = useState(false);
  const [todas, setTodas] = useState(false);
  if (data.incidents_error || !puedeAnotar(ctx, person.id) && !(data.incidents ?? []).some((i) => i.person_id === person.id)) return null;
  const mias = (data.incidents ?? []).filter((i) => i.person_id === person.id || (person.bamboo_id && i.bamboo_id === person.bamboo_id));
  const mes = today().slice(0, 7);
  const n = mias.filter((i) => !i.voided && mesDe(i.occurred_on) === mes).length;
  const lim = umbral(bamboo);
  const lista = mias.filter((i) => todas || !i.voided).slice(0, todas ? 50 : 5);
  return html`<section class="block inc-person">
    <div class="row between"><h2>${t("Incidencias")} <span class="small muted">· ${t("{n} este mes", { n })}</span>${n >= lim && person.id !== ctx.me?.person_id && html` <span class="pill hb-bad">${t("Umbral: hablar con la persona")}</span>`}</h2>
      ${puedeAnotar(ctx, person.id) && html`<button onClick=${() => setNueva(true)}>+ ${t("Incidencia")}</button>`}</div>
    ${lista.length ? html`<ul class="inc-list">${lista.map((i) => html`<${IncidentRow} inc=${i} showPerson=${false} key=${i.id} />`)}</ul>` : html`<${Empty}>${t("Sin incidencias.")}<//>`}
    ${mias.length > 5 || mias.some((i) => i.voided) ? html`<button class="link small" onClick=${() => setTodas(!todas)}>${todas ? t("Ver menos") : t("Ver todas, incluidas las anuladas")}</button>` : ""}
    ${nueva && html`<${IncidentForm} person=${person} onClose=${() => setNueva(false)} />`}
  </section>`;
}

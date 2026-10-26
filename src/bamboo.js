// =====================================================================
//  Horas, desarrollo y vacaciones desde BambooHR (Cambio 13)
//  · Horas: semanal / mensual / desarrollo / vacaciones, por equipo según la jerarquía de Bamboo.
//  · Reglas: solo Gus (horarios, feriados por país, excluidos, configuración, enlaces y actualización).
//  · Bloque Bamboo en el perfil de cada persona.
// =====================================================================
import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import htm from "htm";
import { useApp, t, toast, Modal, Empty, Busy, PersonLink } from "./app.js";

const html = htm.bind(h);

// ---------------------------------------------------------------------
// Fechas y reglas (las mismas que la función bamboo-sync)
// ---------------------------------------------------------------------
const TZ = -4;                        // Bolivia: la fecha límite es el lunes siguiente a las 8:00 (hora de Bolivia)
const HORA_LIMITE = 8;
const TOL = 0.01;
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const toDate = (s) => new Date(s + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * 86400000));
const weekday = (s) => (toDate(s).getUTCDay() + 6) % 7;
const lunesDe = (s) => addDays(s, -weekday(s));
const limiteDe = (s) => toDate(addDays(lunesDe(s), 7)).getTime() + HORA_LIMITE * 3600000;
let _now = null;                                          // para pruebas: window.__TC_NOW = "2026-10-26T10:00"
const nowLocal = () => _now ?? (typeof window !== "undefined" && window.__TC_NOW ? Date.parse(window.__TC_NOW + "Z") : Date.now() + TZ * 3600000);
export const hoyLocal = () => iso(new Date(nowLocal()));
const mini = (s) => `${Number(s.slice(8, 10))} ${MESES[Number(s.slice(5, 7)) - 1].slice(0, 3)}`;
const larga = (s) => `${DIAS[weekday(s)]} ${Number(s.slice(8, 10))} de ${MESES[Number(s.slice(5, 7)) - 1]}`;
export const fmtH = (x) => {
  const v = Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const titulo = (s) => String(s ?? "").replace(/\b\w/g, (c) => c.toUpperCase());
const hace = (ts) => {
  if (!ts) return "";
  const m = Math.round((Date.now() - Date.parse(ts)) / 60000);
  if (m < 1) return t("hace un momento");
  if (m < 60) return t("hace {n} min", { n: m });
  const h = Math.round(m / 60);
  return h < 24 ? t("hace {n} h", { n: h }) : t("hace {n} días", { n: Math.round(h / 24) });
};

/** Estado al momento de mirar: un día "en plazo" pasa a falta/parcial cuando vence. */
export function estado(d) {
  if (d.state === "en_plazo" && nowLocal() >= limiteDe(d.day)) return Number(d.hours) <= TOL ? "falta" : "parcial";
  return d.state;
}
const PROBLEMA = ["falta", "parcial"];

export function resumir(dias) {
  const xs = dias.map((d) => ({ ...d, st: estado(d), h: Number(d.hours), e: Number(d.expected) }));
  const contados = xs.filter((x) => x.st !== "en_plazo");
  const esp = contados.reduce((a, x) => a + x.e, 0);
  let cubierto = 0;
  for (const x of contados) cubierto += x.st === "parcial" ? Math.min(x.h, x.e) : x.st === "falta" ? 0 : x.e;
  const problemas = contados.filter((x) => PROBLEMA.includes(x.st));
  return {
    esp, cubierto, reg: xs.reduce((a, x) => a + x.h, 0),
    faltan: problemas.reduce((a, x) => a + Math.max(x.e - x.h, 0), 0),
    pct: esp ? (100 * cubierto) / esp : 100,
    pendiente: problemas.length > 0, problemas: problemas.map((x) => x.day),
    de_mas: contados.filter((x) => ["exceso", "extra"].includes(x.st)).reduce((a, x) => a + Math.max(x.h - x.e, 0), 0),
    en_plazo: xs.filter((x) => x.st === "en_plazo").length,
    adic: xs.reduce((a, x) => a + Object.values(x.other_projects ?? {}).reduce((s, v) => s + Number(v), 0), 0),
  };
}

const ESTADO_TXT = { ok: "Completo", falta: "Sin registro", parcial: "Incompleto", exceso: "Más horas de lo esperado", extra: "Horas en día libre",
  esperado: "Día libre", justificado: "Justificado", en_plazo: "En plazo", descanso: "Descanso" };

function tooltip(d) {
  const st = estado(d);
  const partes = [`${larga(d.day)}: ${fmtH(d.hours)}h de ${fmtH(d.expected)}h — ${t(ESTADO_TXT[st] ?? st)}`];
  if (d.reason) partes.push(d.reason);
  for (const [p, hh] of Object.entries(d.other_projects ?? {})) partes.push(t("Proyecto adicional (no cuenta): {p} {h}h", { p, h: fmtH(hh) }));
  if (d.note) partes.push(`${t("Comentario")}: “${d.note}”`);
  if (d.ai) partes.push(`IA: ${d.ai}`);
  if (d.before_state) partes.push(t("Antes: {s} ({h}h, visto {f})", { s: t(ESTADO_TXT[d.before_state.state] ?? d.before_state.state), h: fmtH(d.before_state.hours ?? 0), f: d.before_state.seen ? mini(d.before_state.seen) : "—" }));
  return partes.join("\n");
}

function Celda({ d, mes }) {
  if (!d) return html`<span class=${mes ? "q vacio" : "c vacio"}>${mes ? "" : "—"}</span>`;
  const st = estado(d);
  const nt = d.note ? " nt" : "";
  const ad = Object.keys(d.other_projects ?? {}).length ? " ad" : "";
  if (mes) {
    const txt = st === "ok" ? "" : ["extra", "exceso"].includes(st) ? "+" : st === "esperado" ? (d.pto && !d.holiday ? "P" : "F")
      : st === "justificado" ? "✓" : st === "en_plazo" ? "·" : fmtH(d.hours);
    return html`<span class=${`q ${st}${nt}${ad}`} title=${tooltip(d)}>${txt}</span>`;
  }
  let txt = `${fmtH(d.hours)}h`, sub = d.label ?? "";
  if (st === "esperado") { txt = d.label ?? t("Libre"); sub = t("0h esperado"); }
  else if (st === "exceso") sub = t("+{h}h de más", { h: fmtH(d.hours - d.expected) });
  else if (st === "justificado") sub = t("Justificado");
  else if (st === "en_plazo") { txt = `${fmtH(d.hours)} / ${fmtH(d.expected)}h`; sub = t("En plazo"); }
  else if (PROBLEMA.includes(st)) txt = `${fmtH(d.hours)} / ${fmtH(d.expected)}h`;
  const adic = Object.values(d.other_projects ?? {}).reduce((a, v) => a + Number(v), 0);
  return html`<span class=${`c ${st}${nt}`} title=${tooltip(d)}>${txt}${sub && html`<small>${sub}</small>`}${adic > 0 && html`<small class="adx">+${fmtH(adic)}h ${t("adic.")}</small>`}</span>`;
}

function Pill({ r }) {
  if (r.pendiente) return html`<span class="pill hb-bad">${t("Faltan {h}h", { h: fmtH(r.faltan) })}</span>`;
  if (r.de_mas) return html`<span class="pill hb-warn">${t("+{h}h de más", { h: fmtH(r.de_mas) })}</span>`;
  if (r.en_plazo) return html`<span class="pill">${t("En plazo")}</span>`;
  return html`<span class="pill hb-ok">${t("Al día")}</span>`;
}
const tono = (pct, pend) => (pct < 95 ? "low" : pend || pct < 99 ? "mid" : "");

// ---------------------------------------------------------------------
// Datos: índice y equipos según la jerarquía de Bamboo
// ---------------------------------------------------------------------
export function indexBamboo(bb) {
  const emps = new Map((bb.employees ?? []).map((e) => [e.bamboo_id, e]));
  const days = new Map();
  for (const d of bb.days ?? []) {
    if (!days.has(d.bamboo_id)) days.set(d.bamboo_id, new Map());
    days.get(d.bamboo_id).set(d.day, d);
  }
  const hijos = new Map();
  for (const e of emps.values()) if (e.supervisor_id && emps.has(e.supervisor_id) && e.supervisor_id !== e.bamboo_id) {
    if (!hijos.has(e.supervisor_id)) hijos.set(e.supervisor_id, []);
    hijos.get(e.supervisor_id).push(e);
  }
  for (const l of hijos.values()) l.sort((a, b) => a.full_name.localeCompare(b.full_name));
  const by = (arr) => { const m = new Map(); for (const x of arr ?? []) { if (!m.has(x.bamboo_id)) m.set(x.bamboo_id, []); m.get(x.bamboo_id).push(x); } return m; };
  return { emps, days, hijos, goals: by(bb.goals), training: by(bb.training), pto: new Map((bb.pto ?? []).map((p) => [p.bamboo_id, p])) };
}

/** Bloques: "Mis reportes directos" y un bloque por cada líder debajo (con su cadena), en orden jerárquico. */
export function grupos(ix, raiz) {
  const out = [];
  const vistos = new Set([raiz]);
  const directos = (ix.hijos.get(raiz) ?? []).filter((e) => !vistos.has(e.bamboo_id));
  if (!directos.length) return out;
  out.push({ nombre: t("Mis reportes directos"), cadena: [], miembros: directos, nivel: 0 });
  const recorrer = (lider, cadena) => {
    if (vistos.has(lider.bamboo_id)) return;
    vistos.add(lider.bamboo_id);
    const miembros = (ix.hijos.get(lider.bamboo_id) ?? []).filter((h) => !vistos.has(h.bamboo_id) && h.bamboo_id !== raiz);
    if (!miembros.length) return;
    const cad = [...cadena, lider.full_name];
    out.push({ nombre: t("Equipo de {n}", { n: lider.full_name }), cadena: cad, miembros, nivel: cad.length });
    for (const m of miembros) recorrer(m, cad);
  };
  for (const d of directos) recorrer(d, []);
  return out;
}

export function raices(ix, isAdmin, miBamboo) {
  if (!isAdmin) return miBamboo && ix.emps.has(miBamboo) ? [miBamboo] : [];
  return [...ix.emps.values()].filter((e) => !e.supervisor_id || !ix.emps.has(e.supervisor_id)).map((e) => e.bamboo_id);
}

function semanaPorDefecto(hoy) {
  const wd = weekday(hoy);
  return wd >= 5 ? lunesDe(hoy) : addDays(lunesDe(hoy), -7);
}

// ---------------------------------------------------------------------
// Página Horas
// ---------------------------------------------------------------------
export function HorasView() {
  const { bamboo, isAdmin, me, idx } = useApp();
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("tc-horas-tab") || "semana"; } catch (_) { return "semana"; } });
  const setT = (x) => { setTab(x); try { localStorage.setItem("tc-horas-tab", x); } catch (_) {} };
  const hoy = hoyLocal();
  const [lunes, setLunes] = useState(semanaPorDefecto(hoy));
  const [mes, setMes] = useState(hoy.slice(0, 8) + "01");
  const [q, setQ] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const ix = useMemo(() => (bamboo?.available ? indexBamboo(bamboo) : null), [bamboo]);

  if (!bamboo) return html`<section class="page"><${Busy} /></section>`;
  if (!bamboo.available) return html`<section class="page narrow"><h1>${t("Horas")}</h1>
    <p class="warn mt">${isAdmin ? t("Falta preparar la conexión con Bamboo en Supabase (correr 06_bamboo.sql). Detalle: {e}", { e: bamboo.error ?? "" }) : t("La conexión con Bamboo todavía no está lista.")}</p></section>`;
  const miBamboo = me?.person_id ? idx.person(me.person_id)?.bamboo_id : null;
  const rs = raices(ix, isAdmin, miBamboo);
  const ultimo = bamboo.log?.find((l) => l.ok);

  const cab = html`<header class="page-head">
    <div>
      <h1>${t("Horas")}</h1>
      <p class="muted">${ultimo ? t("Datos de Bamboo, actualizados {h}.", { h: hace(ultimo.finished_at) }) : t("Todavía no hay datos de Bamboo.")}
        ${" "}${t("La semana vence el lunes siguiente a las 8:00 (hora de Bolivia).")}</p>
    </div>
    ${isAdmin && html`<${SyncButton} />`}
  </header>`;

  if (!rs.length) return html`<section class="page">${cab}<${Empty}>${isAdmin ? t("Todavía no hay datos. Presiona “Actualizar desde Bamboo”.") : t("Tu usuario todavía no está enlazado con Bamboo o no tienes gente a cargo. Avísale a Gus.")}<//></section>`;
  const gs = rs.flatMap((r) => grupos(ix, r));
  const personas = [...new Map(gs.flatMap((g) => g.miembros).map((e) => [e.bamboo_id, e])).values()];
  const match = (e) => !q || norm(e.full_name).includes(norm(q));

  return html`<section class="page horas">
    ${cab}
    <div class="row between hb-bar">
      <div class="seg" role="tablist">
        ${[["semana", t("Semanal")], ["mes", t("Mensual")], ["dev", t("Desarrollo")], ["vac", t("Vacaciones")]].map(([k, l]) =>
          html`<button role="tab" aria-selected=${tab === k} class=${tab === k ? "on" : ""} onClick=${() => setT(k)}>${l}</button>`)}
      </div>
      <div class="row">
        <input class="search" type="search" placeholder=${t("Buscar persona")} value=${q} onInput=${(e) => setQ(e.target.value)} aria-label=${t("Buscar persona")} />
        ${(tab === "semana" || tab === "mes") && html`<label class="check small"><input type="checkbox" checked=${soloAlertas} onChange=${(e) => setSoloAlertas(e.target.checked)} />${t("Solo con alertas")}</label>`}
      </div>
    </div>
    ${tab === "semana" && html`<${Periodo} ix=${ix} gs=${gs} personas=${personas} match=${match} soloAlertas=${soloAlertas} modo="semana" ini=${lunes} setIni=${setLunes} />`}
    ${tab === "mes" && html`<${Periodo} ix=${ix} gs=${gs} personas=${personas} match=${match} soloAlertas=${soloAlertas} modo="mes" ini=${mes} setIni=${setMes} />`}
    ${tab === "dev" && html`<${Desarrollo} ix=${ix} gs=${gs} match=${match} />`}
    ${tab === "vac" && html`<${Vacaciones} ix=${ix} gs=${gs} match=${match} />`}
  </section>`;
}

export function SyncButton() {
  const { api, reloadBamboo } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.syncBamboo();
      toast(r?.message ? t("Listo: {m}", { m: r.message }) : t("Listo"));
      if (r?.stats?.avisos?.length) toast(r.stats.avisos[0], "bad");
    } catch (x) { toast(x.message, "bad"); }
    await reloadBamboo();
    setBusy(false);
  };
  return html`<button class="primary" disabled=${busy} onClick=${run}>${busy ? html`<span class="spinner" aria-hidden="true"></span>${t("Actualizando… (hasta 1 min)")}` : t("Actualizar desde Bamboo")}</button>`;
}

function diasDelPeriodo(modo, ini, hoy) {
  const out = [];
  if (modo === "semana") for (let i = 0; i < 7; i++) out.push(addDays(ini, i));
  else for (let d = ini; d.slice(0, 7) === ini.slice(0, 7); d = addDays(d, 1)) out.push(d);
  return out.filter((d) => d < hoy || modo === "semana");
}

function Periodo({ ix, gs, personas, match, soloAlertas, modo, ini, setIni }) {
  const hoy = hoyLocal();
  const todos = diasDelPeriodo(modo, ini, hoy);
  const pasados = todos.filter((d) => d < hoy);
  const ids = personas.map((e) => e.bamboo_id);
  // Fines de semana: solo si alguien tiene registro ese día
  const cols = todos.filter((d) => weekday(d) < 5 || ids.some((id) => ix.days.get(id)?.has(d)));
  const diasDe = (id) => pasados.map((d) => ix.days.get(id)?.get(d)).filter(Boolean);
  const res = new Map(ids.map((id) => [id, resumir(diasDe(id))]));
  const conDatos = ids.filter((id) => diasDe(id).length);
  const minDia = [...ix.days.values()].flatMap((m) => [...m.keys()]).sort()[0] ?? hoy;

  const nav = modo === "semana"
    ? { prev: addDays(ini, -7), next: addDays(ini, 7), label: `${mini(ini)} – ${mini(addDays(ini, 6))}`, canPrev: addDays(ini, -1) >= minDia, canNext: addDays(ini, 7) <= hoy }
    : (() => {
      const y = Number(ini.slice(0, 4)), m = Number(ini.slice(5, 7));
      const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      return { prev, next, label: `${titulo(MESES[m - 1])} ${y}` + (pasados.length ? ` · ${t("hasta el {d}", { d: mini(pasados[pasados.length - 1]) })}` : ""), canPrev: addDays(ini, -1) >= minDia, canNext: next <= hoy };
    })();

  const rs = conDatos.map((id) => res.get(id));
  const nPend = rs.filter((r) => r.pendiente).length, nMas = rs.filter((r) => !r.pendiente && r.de_mas).length;
  const enPlazo = pasados.some((d) => nowLocal() < limiteDe(d));

  return html`<div>
    <div class="row between hb-period">
      <div class="row">
        <button class="icon" disabled=${!nav.canPrev} onClick=${() => setIni(nav.prev)} aria-label=${t("Anterior")}>‹</button>
        <strong class="hb-plabel">${nav.label}</strong>
        <button class="icon" disabled=${!nav.canNext} onClick=${() => setIni(nav.next)} aria-label=${t("Siguiente")}>›</button>
      </div>
      ${enPlazo && html`<span class="small muted">${t("Hay días que todavía no vencen: se muestran “en plazo” y no cuentan en el %.")}</span>`}
    </div>
    <div class="pulse">
      <span class="pulse-item"><strong>${conDatos.length}</strong> ${t("personas")}</span>
      <span class=${"pulse-item" + (nPend ? " alert" : "")}><strong>${nPend}</strong> ${t("con horas faltantes")}</span>
      <span class=${"pulse-item" + (nMas ? " gold" : "")}><strong>${nMas}</strong> ${t("con horas de más")}</span>
      <span class="pulse-item"><strong>${fmtH(rs.reduce((a, r) => a + r.faltan, 0))}h</strong> ${t("faltantes en total")}</span>
    </div>
    <${Leyenda} mes=${modo === "mes"} />
    ${!conDatos.length && html`<${Empty}>${t("No hay datos de Bamboo para este período.")}<//>`}
    ${conDatos.length > 0 && gs.map((g, i) => {
      const ms = g.miembros.filter((e) => res.get(e.bamboo_id) && diasDe(e.bamboo_id).length && match(e) && (!soloAlertas || res.get(e.bamboo_id).pendiente || res.get(e.bamboo_id).de_mas));
      if (!ms.length) return null;
      return html`<${Grupo} key=${g.nombre + i} g=${g} ms=${ms} res=${res} cols=${cols} ix=${ix} modo=${modo} pasados=${pasados} />`;
    })}
  </div>`;
}

function Leyenda({ mes }) {
  const it = [["ok", t("Completo")], ["parcial", t("Incompleto")], ["falta", t("Sin registro")], ["exceso", t("Horas de más")], ["extra", t("Horas en día libre")],
    ["esperado", t("Feriado / PTO")], ["justificado", t("Justificado (IA)")], ["en_plazo", t("En plazo")]];
  return html`<div class="hb-legend small muted">${it.map(([k, l]) => html`<span><i class=${"sw " + k}></i>${l}</span>`)}
    <span><i class="sw nt"></i>${t("con comentario")}</span>${mes && html`<span>F ${t("feriado")} · P PTO · + ${t("de más")}</span>`}</div>`;
}

function Grupo({ g, ms, res, cols: todas, ix, modo, pasados }) {
  // Sáb/dom solo si alguien de este equipo tiene registro ese día
  const cols = todas.filter((d) => weekday(d) < 5 || ms.some((e) => ix.days.get(e.bamboo_id)?.has(d)));
  const rs = ms.map((e) => res.get(e.bamboo_id));
  const esp = rs.reduce((a, r) => a + r.esp, 0), cub = rs.reduce((a, r) => a + r.cubierto, 0);
  const pct = esp ? (100 * cub) / esp : 100;
  const pend = ms.filter((e) => res.get(e.bamboo_id).pendiente);
  const mas = ms.filter((e) => !res.get(e.bamboo_id).pendiente && res.get(e.bamboo_id).de_mas);
  const corto = (xs) => xs.slice(0, 3).join(", ") + (xs.length > 3 ? t(" y {n} más", { n: xs.length - 3 }) : "");
  const linea = [
    pend.length && t("Faltan horas: {l}", { l: corto(pend.map((e) => `${e.full_name} (${res.get(e.bamboo_id).problemas.map((d) => Number(d.slice(8))).join(", ")})`)) }),
    mas.length && t("Horas de más: {l}", { l: corto(mas.map((e) => `${e.full_name} (+${fmtH(res.get(e.bamboo_id).de_mas)}h)`)) }),
  ].filter(Boolean).join(" · ") || t("Todo al día");
  const orden = [...ms].sort((a, b) => {
    const ra = res.get(a.bamboo_id), rb = res.get(b.bamboo_id);
    return (rb.pendiente - ra.pendiente) || ((rb.de_mas > 0) - (ra.de_mas > 0)) || (ra.pct - rb.pct) || a.full_name.localeCompare(b.full_name);
  });
  return html`<details class="hb-group" open=${pend.length > 0 || g.nivel === 0} style=${`--lvl:${Math.min(g.nivel, 4)}`}>
    <summary>
      <span class="hb-gname"><strong>${g.nombre}</strong>${g.cadena.length > 1 && html`<span class="small muted"> · ${g.cadena.join(" › ")}</span>`}</span>
      <span class=${"hb-gline small " + (pend.length ? "bad" : mas.length ? "warn" : "ok")}>${linea}</span>
      <span class="hb-gpct"><span class="hb-track"><span class=${"hb-fill " + tono(pct, pend.length > 0)} style=${`width:${Math.min(pct, 100)}%`}></span></span><b>${Math.floor(pct)}%</b></span>
    </summary>
    <div class="hb-scroll">
      <table class=${"tbl hb-tbl " + (modo === "mes" ? "mes" : "sem")}>
        <thead><tr><th>${t("Persona")}</th>${cols.map((d) => html`<th class="d">${modo === "mes" ? html`${Number(d.slice(8))}<br /><span class="muted">${DIAS[weekday(d)][0]}</span>` : html`${DIAS[weekday(d)]}<br /><span class="muted">${Number(d.slice(8))}</span>`}</th>`)}
          <th class="right">${t("Horas")}</th><th class="right">%</th><th>${t("Estado")}</th></tr></thead>
        <tbody>${orden.map((e) => html`<${Fila} key=${e.bamboo_id} e=${e} r=${res.get(e.bamboo_id)} cols=${cols} ix=${ix} modo=${modo} pasados=${pasados} />`)}</tbody>
      </table>
    </div>
  </details>`;
}

function Fila({ e, r, cols, ix, modo, pasados }) {
  const [open, setOpen] = useState(false);
  const { idx } = useApp();
  const dm = ix.days.get(e.bamboo_id) ?? new Map();
  const hoy = hoyLocal();
  const enRango = new Set(pasados);
  const obs = (e.obs ?? []).filter((o) => !o.fechas?.length || o.fechas.some((f) => enRango.has(f)));
  const notas = pasados.map((d) => dm.get(d)).filter((d) => d?.note);
  const corr = pasados.map((d) => dm.get(d)).filter((d) => d?.before_state);
  const adic = {};
  for (const d of pasados) for (const [p, v] of Object.entries(dm.get(d)?.other_projects ?? {})) adic[p] = (adic[p] ?? 0) + Number(v);
  const persona = e.person_id && idx.person(e.person_id);
  const n = obs.length + corr.length;
  return html`<tr class=${"hb-row" + (open ? " open" : "")} onClick=${() => setOpen(!open)}>
      <td class="hb-name"><span>${e.full_name}</span><span class="small muted">${e.info}</span>${n > 0 && html`<span class="hb-obs" title=${t("Observaciones")}>${n}</span>`}</td>
      ${cols.map((d) => html`<td class="d">${d >= hoy ? html`<span class=${modo === "mes" ? "q vacio" : "c vacio"}></span>` : html`<${Celda} d=${dm.get(d)} mes=${modo === "mes"} />`}</td>`)}
      <td class="right nowrap">${fmtH(r.reg)}<span class="muted">/${fmtH(r.esp)}h</span>${r.adic > 0 && html`<div class="small adx">+${fmtH(r.adic)}h ${t("adic.")}</div>`}</td>
      <td class="right"><b class=${"hb-pct " + tono(r.pct, r.pendiente)}>${Math.floor(r.pct)}%</b></td>
      <td><${Pill} r=${r} /></td>
    </tr>
    ${open && html`<tr class="hb-detail"><td colspan=${cols.length + 4}>
      <div class="hb-det">
        ${obs.map((o) => html`<p class=${"hb-o " + o.tipo}><span class="pill">${o.fuente}</span> ${o.texto}</p>`)}
        ${corr.map((d) => html`<p class="hb-o info"><span class="pill">${t("Corregido")}</span> ${t("{d}: antes {s} ({h}h, visto {f}); ahora {a}.", { d: mini(d.day), s: t(ESTADO_TXT[d.before_state.state] ?? ""), h: fmtH(d.before_state.hours ?? 0), f: d.before_state.seen ? mini(d.before_state.seen) : "—", a: t(ESTADO_TXT[estado(d)] ?? "") })}</p>`)}
        ${notas.length > 0 && html`<div><h4 class="small">${t("Comentarios")}</h4>${notas.map((d) => html`<p class="small"><b>${mini(d.day)}</b> ${d.note}</p>`)}</div>`}
        ${Object.keys(adic).length > 0 && html`<p class="small"><b>${t("Otros proyectos (no cuentan):")}</b> ${Object.entries(adic).map(([p, v]) => `${p} ${fmtH(v)}h`).join(" · ")}</p>`}
        ${!obs.length && !notas.length && !corr.length && !Object.keys(adic).length && html`<p class="small muted">${t("Sin observaciones en este período.")}</p>`}
        ${persona && html`<p class="small"><a href=${"#/persona/" + persona.id} onClick=${(ev) => ev.stopPropagation()}>${t("Ver perfil en Team Coach")} →</a></p>`}
      </div>
    </td></tr>`}`;
}

// ---------------------------------------------------------------------
// Desarrollo
// ---------------------------------------------------------------------
export function resumenDev(goals = [], training = [], hoy = hoyLocal()) {
  const activos = goals.filter((g) => g.state === "en_progreso");
  const anio = training.filter((x) => x.day && x.day.slice(0, 4) === hoy.slice(0, 4));
  const mes = anio.filter((x) => x.day.slice(0, 7) === hoy.slice(0, 7));
  return { activos: activos.length, completados: goals.filter((g) => g.state === "completado").length,
    vencidos: goals.filter((g) => g.overdue), proximos: goals.filter((g) => g.soon),
    avance: activos.length ? activos.reduce((a, g) => a + Number(g.pct), 0) / activos.length : null,
    h_mes: mes.reduce((a, x) => a + Number(x.hours), 0), h_anio: anio.reduce((a, x) => a + Number(x.hours), 0), n_cursos: anio.length };
}

function GoalItem({ g }) {
  const [est, cls] = g.state === "completado" ? [t("Completado"), "hb-ok"] : g.state === "cerrado" ? [t("Cerrado"), ""]
    : g.overdue ? [t("Vencido {d}", { d: mini(g.due) }), "hb-bad"] : g.soon ? [t("Vence {d}", { d: mini(g.due) }), "hb-warn"]
    : [g.due ? t("Vence {d}", { d: mini(g.due) }) : t("Sin fecha"), ""];
  const fc = g.state === "completado" || g.pct >= 80 ? "" : g.pct >= 40 ? "mid" : "low";
  return html`<div class="hb-goal"><span>${g.title}</span><span class="hb-track sm"><span class=${"hb-fill " + fc} style=${`width:${g.pct}%`}></span></span><span class="small">${Math.round(g.pct)}%</span><span class=${"pill " + cls}>${est}</span></div>`;
}

function Desarrollo({ ix, gs, match }) {
  const hoy = hoyLocal();
  const ids = [...new Set(gs.flatMap((g) => g.miembros.map((e) => e.bamboo_id)))];
  const rs = ids.map((id) => resumenDev(ix.goals.get(id), ix.training.get(id), hoy));
  const sinGoals = rs.filter((r) => !r.activos && !r.completados).length;
  return html`<div>
    <div class="pulse">
      <span class="pulse-item"><strong>${rs.reduce((a, r) => a + r.activos, 0)}</strong> ${t("goals en curso")}</span>
      <span class=${"pulse-item" + (rs.some((r) => r.vencidos.length) ? " alert" : "")}><strong>${rs.reduce((a, r) => a + r.vencidos.length, 0)}</strong> ${t("vencidos")}</span>
      <span class=${"pulse-item" + (rs.some((r) => r.proximos.length) ? " gold" : "")}><strong>${rs.reduce((a, r) => a + r.proximos.length, 0)}</strong> ${t("por vencer (14 días, bajo 80%)")}</span>
      <span class="pulse-item"><strong>${fmtH(rs.reduce((a, r) => a + r.h_anio, 0))}h</strong> ${t("de estudio en {y}", { y: hoy.slice(0, 4) })}</span>
      <span class="pulse-item"><strong>${sinGoals}</strong> ${t("sin goals")}</span>
    </div>
    ${gs.map((g, i) => {
      const ms = g.miembros.filter(match);
      if (!ms.length) return null;
      return html`<details class="hb-group" open=${g.nivel === 0} key=${"d" + i} style=${`--lvl:${Math.min(g.nivel, 4)}`}>
        <summary><span class="hb-gname"><strong>${g.nombre}</strong>${g.cadena.length > 1 && html`<span class="small muted"> · ${g.cadena.join(" › ")}</span>`}</span></summary>
        <table class="tbl hb-dev"><thead><tr><th>${t("Persona")}</th><th>${t("Goals")}</th><th>${t("Avance")}</th><th>${t("Alertas")}</th><th class="right">${t("Estudio mes")}</th><th class="right">${t("Estudio año")}</th></tr></thead>
          <tbody>${ms.map((e) => html`<${FilaDev} key=${e.bamboo_id} e=${e} r=${resumenDev(ix.goals.get(e.bamboo_id), ix.training.get(e.bamboo_id), hoy)} ix=${ix} />`)}</tbody></table>
      </details>`;
    })}
  </div>`;
}

function FilaDev({ e, r, ix }) {
  const [open, setOpen] = useState(false);
  const goals = [...(ix.goals.get(e.bamboo_id) ?? [])].sort((a, b) => (a.state === "en_progreso" ? 0 : 1) - (b.state === "en_progreso" ? 0 : 1) || String(a.due ?? "9").localeCompare(String(b.due ?? "9")));
  const trn = [...(ix.training.get(e.bamboo_id) ?? [])].sort((a, b) => String(b.day ?? "").localeCompare(String(a.day ?? "")));
  return html`<tr class="hb-row" onClick=${() => setOpen(!open)}>
      <td>${e.full_name}</td>
      <td>${r.activos} ${t("en curso")}${r.completados ? html` <span class="muted small">· ${r.completados} ${t("completados")}</span>` : ""}</td>
      <td>${r.avance === null ? html`<span class="muted">—</span>` : html`<span class="hb-track sm"><span class=${"hb-fill " + (r.avance >= 80 ? "" : r.avance >= 40 ? "mid" : "low")} style=${`width:${r.avance}%`}></span></span> ${Math.round(r.avance)}%`}</td>
      <td>${r.vencidos.length > 0 && html`<span class="pill hb-bad">${r.vencidos.length} ${t("vencido(s)")}</span>`} ${r.proximos.length > 0 && html`<span class="pill hb-warn">${r.proximos.length} ${t("por vencer")}</span>`}${!r.activos && !r.completados && html`<span class="pill">${t("Sin goals")}</span>`}</td>
      <td class="right">${fmtH(r.h_mes)}h</td><td class="right">${fmtH(r.h_anio)}h <span class="muted small">(${r.n_cursos})</span></td>
    </tr>
    ${open && html`<tr class="hb-detail"><td colspan="6"><div class="hb-det">
      <h4 class="small">${t("Goals")}</h4>${goals.length ? goals.map((g) => html`<${GoalItem} g=${g} />`) : html`<p class="small muted">${t("Sin goals en Bamboo.")}</p>`}
      <h4 class="small mt">${t("Training")}</h4>${trn.length ? trn.map((x) => html`<p class="small"><b>${x.day ? mini(x.day) : "—"}</b> ${x.name}${x.notes ? ` · ${x.notes.slice(0, 80)}` : ""} · ${fmtH(x.hours)}h ${x.links?.map((u) => html` <a href=${u} target="_blank" rel="noopener" onClick=${(ev) => ev.stopPropagation()}>${t("certificado")}</a>`)}</p>`) : html`<p class="small muted">${t("Sin cursos registrados.")}</p>`}
    </div></td></tr>`}`;
}

// ---------------------------------------------------------------------
// Vacaciones
// ---------------------------------------------------------------------
function nivelPill(v, dic) {
  if (v.level === "low") return html`<span class="pill hb-bad">${dic ? t("Muchos días") : t("Muy atrasado")}</span>`;
  if (v.level === "mid") return html`<span class="pill hb-warn">${t("Algo atrasado")}</span>`;
  return html`<span class="pill hb-ok">${t("Al ritmo")}</span>`;
}

function Vacaciones({ ix, gs, match }) {
  const hoy = hoyLocal();
  const dic = hoy.slice(5, 7) === "12";
  const ids = [...new Set(gs.flatMap((g) => g.miembros.map((e) => e.bamboo_id)))].filter((id) => ix.pto.has(id));
  const vals = ids.map((id) => ix.pto.get(id));
  if (!vals.length) return html`<${Empty}>${t("No hay saldos de vacaciones disponibles.")}<//>`;
  const nR = vals.filter((v) => v.level === "low").length, nA = vals.filter((v) => v.level === "mid").length;
  const transc = Number(vals[0].elapsed);
  return html`<div>
    <p class="muted">${dic ? t("Diciembre: máximo 3 días sin planificar.") : t("Meta: llegar a fin de año con 0 días. Ideal hoy: haber usado o planificado ~{p}% de los días del año (a diciembre, máximo 3 días).", { p: Math.round(100 * transc) })}</p>
    <div class="pulse">
      <span class="pulse-item"><strong>${vals.length - nR - nA}</strong> ${t("al ritmo")}</span>
      <span class=${"pulse-item" + (nA ? " gold" : "")}><strong>${nA}</strong> ${t("algo atrasados")}</span>
      <span class=${"pulse-item" + (nR ? " alert" : "")}><strong>${nR}</strong> ${t("muy atrasados")}</span>
      <span class="pulse-item"><strong>${fmtH(vals.reduce((a, v) => a + Number(v.unplanned), 0))}</strong> ${t("días sin planificar (total)")}</span>
    </div>
    ${gs.map((g, i) => {
      const ms = g.miembros.filter((e) => ix.pto.has(e.bamboo_id) && match(e))
        .sort((a, b) => (Number(ix.pto.get(b.bamboo_id).unplanned) - Number(ix.pto.get(b.bamboo_id).ideal)) - (Number(ix.pto.get(a.bamboo_id).unplanned) - Number(ix.pto.get(a.bamboo_id).ideal)) || a.full_name.localeCompare(b.full_name));
      if (!ms.length) return null;
      return html`<details class="hb-group" open key=${"v" + i} style=${`--lvl:${Math.min(g.nivel, 4)}`}>
        <summary><span class="hb-gname"><strong>${g.nombre}</strong>${g.cadena.length > 1 && html`<span class="small muted"> · ${g.cadena.join(" › ")}</span>`}</span></summary>
        <table class="tbl hb-vac"><thead><tr><th>${t("Persona")}</th><th>${t("Tipo")}</th><th class="right">${t("Total año")}</th><th class="right">${t("Usados")}</th><th class="right">${t("Planificados")}</th><th class="right">${t("Sin planificar")}</th><th class="right">${t("Ideal hoy")}</th><th>${t("Ritmo")}</th></tr></thead>
          <tbody>${ms.map((e) => { const v = ix.pto.get(e.bamboo_id); return html`<tr key=${e.bamboo_id}><td>${e.full_name}</td><td class="small muted">${v.kind}</td>
            <td class="right">${fmtH(v.total)}</td><td class="right">${fmtH(v.used)}</td><td class="right">${fmtH(v.planned)}</td><td class="right"><b>${fmtH(v.unplanned)}</b></td>
            <td class="right muted">${fmtH(v.ideal)}</td><td>${nivelPill(v, dic)}</td></tr>`; })}</tbody></table>
      </details>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------------
// Bloque en el perfil de la persona
// ---------------------------------------------------------------------
export function BambooPersonBlock({ person }) {
  const { bamboo } = useApp();
  const ix = useMemo(() => (bamboo?.available ? indexBamboo(bamboo) : null), [bamboo]);
  if (!ix || !person?.bamboo_id) return null;
  const e = ix.emps.get(person.bamboo_id);
  if (!e) return null;
  const hoy = hoyLocal();
  const dm = ix.days.get(e.bamboo_id) ?? new Map();
  const lunes = semanaPorDefecto(hoy);
  const sem = Array.from({ length: 7 }, (_, i) => addDays(lunes, i)).filter((d) => weekday(d) < 5 || dm.has(d));
  const rSem = resumir(sem.filter((d) => d < hoy).map((d) => dm.get(d)).filter(Boolean));
  const mesDias = [...dm.keys()].filter((d) => d.slice(0, 7) === hoy.slice(0, 7) && d < hoy);
  const rMes = resumir(mesDias.map((d) => dm.get(d)));
  const dev = resumenDev(ix.goals.get(e.bamboo_id), ix.training.get(e.bamboo_id), hoy);
  const v = ix.pto.get(e.bamboo_id);
  const tieneEquipo = (ix.hijos.get(e.bamboo_id) ?? []).length > 0;
  return html`<section class="block hb-person">
    <div class="row between"><h2>${t("En Bamboo")}</h2><a class="small" href="#/horas">${tieneEquipo ? t("Ver horas de su equipo") : t("Ver todas las horas")} →</a></div>
    <div class="hb-pgrid">
      <div class="hb-card hb-wide">
        <h3>${t("Semana {a} – {b}", { a: mini(lunes), b: mini(addDays(lunes, 6)) })}</h3>
        <div class="hb-strip">${sem.map((d) => html`<div><span class="small muted">${DIAS[weekday(d)]}</span>${d >= hoy ? html`<span class="c vacio"></span>` : html`<${Celda} d=${dm.get(d)} />`}</div>`)}</div>
        <p class="small"><${Pill} r=${rSem} /></p>
      </div>
      <div class="hb-card">
        <h3>${t("Mes en curso")}</h3>
        <p><b class=${"hb-big " + tono(rMes.pct, rMes.pendiente)}>${Math.floor(rMes.pct)}%</b> <span class="small muted">${fmtH(rMes.cubierto)} / ${fmtH(rMes.esp)}h</span></p>
        ${rMes.problemas.length > 0 ? html`<p class="small">${t("Días pendientes: {d}", { d: rMes.problemas.map(mini).join(", ") })}</p>` : html`<p class="small muted">${t("Sin días pendientes.")}</p>`}
      </div>
      <div class="hb-card">
        <h3>${t("Desarrollo")}</h3>
        <p class="small">${t("{a} goals en curso", { a: dev.activos })}${dev.avance !== null ? ` · ${Math.round(dev.avance)}%` : ""}${dev.vencidos.length ? html` · <span class="late-t">${dev.vencidos.length} ${t("vencido(s)")}</span>` : ""}</p>
        <p class="small">${t("Estudio: {m}h este mes · {y}h en el año", { m: fmtH(dev.h_mes), y: fmtH(dev.h_anio) })}</p>
      </div>
      ${v && html`<div class="hb-card">
        <h3>${t("Vacaciones")}</h3>
        <p class="small">${t("{u} días sin planificar de {tot}", { u: fmtH(v.unplanned), tot: fmtH(v.total) })}</p>
        <p class="small">${nivelPill(v, hoy.slice(5, 7) === "12")}</p>
      </div>`}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------
// Reglas (solo Gus)
// ---------------------------------------------------------------------
const DIA_OPC = [0, 1, 2, 3, 4, 5, 6];
const rangoTxt = (dias) => {
  const set = new Set(dias);
  for (let ini = 0; ini < 7; ini++) {
    const orden = Array.from({ length: set.size }, (_, i) => (ini + i) % 7);
    if (orden.every((d) => set.has(d))) return `${DIAS[orden[0]].toLowerCase()} a ${DIAS[orden[orden.length - 1]].toLowerCase()}`;
  }
  return [...set].sort().map((d) => DIAS[d].toLowerCase()).join(", ");
};

export function ReglasView() {
  const { bamboo, isAdmin } = useApp();
  const [sec, setSec] = useState("estado");
  if (!isAdmin) return null;
  if (!bamboo) return html`<section class="page"><${Busy} /></section>`;
  if (!bamboo.available) return html`<section class="page narrow"><h1>${t("Reglas")}</h1><p class="warn mt">${t("Falta preparar la conexión con Bamboo en Supabase (correr 06_bamboo.sql). Detalle: {e}", { e: bamboo.error ?? "" })}</p></section>`;
  const secs = [["estado", t("Actualización y enlaces")], ["horarios", t("Horarios")], ["feriados", t("Feriados por país")], ["excluidos", t("Excluidos")], ["config", t("Configuración")]];
  return html`<section class="page reglas">
    <header class="page-head"><div><h1>${t("Reglas")}</h1>
      <p class="muted">${t("Solo tú ves y editas esta sección. Los cambios se aplican en la próxima actualización desde Bamboo.")}</p></div>
      <${SyncButton} /></header>
    <div class="seg hb-secs" role="tablist">${secs.map(([k, l]) => html`<button role="tab" aria-selected=${sec === k} class=${sec === k ? "on" : ""} onClick=${() => setSec(k)}>${l}</button>`)}</div>
    ${sec === "estado" && html`<${EstadoSync} />`}
    ${sec === "horarios" && html`<${Horarios} />`}
    ${sec === "feriados" && html`<${Feriados} />`}
    ${sec === "excluidos" && html`<${Excluidos} />`}
    ${sec === "config" && html`<${Config} />`}
  </section>`;
}

function EstadoSync() {
  const { bamboo, data, api, reload } = useApp();
  const log = bamboo.log ?? [];
  const ok = log.find((l) => l.ok);
  const st = ok?.stats ?? {};
  const en = st.enlaces ?? {};
  const emps = [...(bamboo.employees ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const activos = data.people.filter((p) => p.status === "activo" || p.status === "pausado").sort((a, b) => a.full_name.localeCompare(b.full_name));
  const usado = new Map(data.people.filter((p) => p.bamboo_id).map((p) => [p.bamboo_id, p]));
  const [filtro, setFiltro] = useState("todos");
  const setLink = async (p, bid) => {
    try {
      if (bid) { const otro = usado.get(bid); if (otro && otro.id !== p.id) await api.update("people", otro.id, { bamboo_id: null }); }
      await api.update("people", p.id, { bamboo_id: bid || null });
      toast(t("Enlace guardado")); reload();
    } catch (x) { toast(x.message, "bad"); }
  };
  const lista = (titulo2, xs, render, vacio) => html`<div class="hb-card"><h3>${titulo2} <span class="pill">${xs?.length ?? 0}</span></h3>
    ${xs?.length ? html`<ul class="hb-list small">${xs.map(render)}</ul>` : html`<p class="small muted">${vacio}</p>`}</div>`;
  const filas = activos.filter((p) => filtro === "todos" || (filtro === "sin" && !p.bamboo_id) || (filtro === "lideres" && p.is_lead));
  return html`<div>
    <div class="block-s">
      <h2>${t("Última actualización")}</h2>
      ${ok ? html`<p>${t("{m}. Actualizado {h} ({s} s). Período revisado: {a} a {b}. IA: {ia}.", { m: ok.message, h: hace(ok.finished_at), s: st.segundos ?? "?", a: st.desde ? mini(st.desde) : "—", b: st.hasta ? mini(st.hasta) : "—", ia: st.ia ?? "—" })}</p>` : html`<p class="muted">${t("Todavía no se actualizó nunca.")}</p>`}
      ${(st.avisos ?? []).map((a) => html`<p class="warn small">${a}</p>`)}
      <p class="small muted">${t("Automático: lunes a viernes cada hora de 8:05 a 19:05 (si activaste 07_bamboo_cron.sql).")}</p>
      <details class="mt"><summary>${t("Historial ({n})", { n: log.length })}</summary>
        <table class="tbl small"><thead><tr><th>${t("Inicio")}</th><th>${t("Origen")}</th><th>${t("Resultado")}</th></tr></thead>
          <tbody>${log.map((l) => html`<tr key=${l.id}><td>${new Date(l.started_at).toLocaleString()}</td><td>${l.source === "cron" ? t("Automático") : t("Botón")}</td>
            <td class=${l.ok === false ? "late-t" : ""}>${l.ok === null || l.ok === undefined ? (l.finished_at ? "—" : t("En curso…")) : l.message}</td></tr>`)}</tbody></table>
      </details>
    </div>

    <div class="block">
      <h2>${t("Enlace Team Coach ↔ Bamboo")}</h2>
      <p class="small muted">${t("Se enlaza solo por correo y nombre. Revisa lo marcado: así cada líder ve las horas de su gente. Si algo está mal, corrígelo abajo.")}</p>
      <div class="hb-pgrid">
        ${lista(t("Enlazados por parecido (confirma)"), en.parecido, (x) => html`<li>${x.person} ↔ ${x.bamboo}</li>`, t("Ninguno."))}
        ${lista(t("Líderes sin Bamboo (no verán horas)"), en.lideres_sin_bamboo, (x) => html`<li>${x}</li>`, t("Todos enlazados."))}
        ${lista(t("En Team Coach pero no en Bamboo"), en.sin_bamboo, (x) => html`<li>${x}</li>`, t("Ninguno."))}
        ${lista(t("En Bamboo pero no en Team Coach"), en.solo_en_bamboo, (x) => html`<li>${x}</li>`, t("Ninguno."))}
        ${lista(t("Correo distinto"), en.correo_distinto, (x) => html`<li>${x.person}: ${x.team_coach} / ${x.bamboo}</li>`, t("Ninguno."))}
      </div>
      <div class="row between mt"><h3>${t("Enlace manual")}</h3>
        <div class="seg">${[["todos", t("Todos")], ["sin", t("Sin enlace")], ["lideres", t("Líderes")]].map(([k, l]) => html`<button class=${filtro === k ? "on" : ""} onClick=${() => setFiltro(k)}>${l}</button>`)}</div></div>
      <table class="tbl"><thead><tr><th>${t("Persona en Team Coach")}</th><th>${t("Empleado en Bamboo")}</th></tr></thead>
        <tbody>${filas.map((p) => html`<tr key=${p.id}><td><${PersonLink} id=${p.id} />${p.is_lead && html` <span class="pill">${t("lead")}</span>`}</td>
          <td><select class="mini" value=${p.bamboo_id ?? ""} onChange=${(ev) => setLink(p, ev.target.value)}>
            <option value="">${t("— sin enlace —")}</option>
            ${emps.map((e) => html`<option value=${e.bamboo_id}>${e.full_name}${usado.get(e.bamboo_id) && usado.get(e.bamboo_id).id !== p.id ? " ✓" : ""}</option>`)}
          </select></td></tr>`)}</tbody></table>
    </div>
  </div>`;
}

function Horarios() {
  const { bamboo, api, reloadBamboo } = useApp();
  const [nombre, setNombre] = useState("");
  const [dias, setDias] = useState([0, 1, 2, 3, 4]);
  const [nota, setNota] = useState("");
  const rows = bamboo.rules?.schedules ?? [];
  const nombres = [...(bamboo.employees ?? [])].map((e) => e.full_name).sort();
  const enBamboo = new Set(nombres.map(norm));
  const toggle = (d) => setDias(dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d].sort());
  const guardar = async (ev) => {
    ev.preventDefault();
    if (!nombre.trim() || !dias.length) return toast(t("Elige la persona y al menos un día."), "bad");
    try {
      const ex = rows.find((r) => norm(r.full_name) === norm(nombre));
      if (ex) await api.update("rule_schedules", ex.id, { days: dias, note: nota || null, updated_at: new Date().toISOString() });
      else await api.insert("rule_schedules", [{ full_name: nombre.trim(), days: dias, note: nota || null }]);
      setNombre(""); setNota(""); setDias([0, 1, 2, 3, 4]); toast(t("Horario guardado")); reloadBamboo();
    } catch (x) { toast(x.message, "bad"); }
  };
  return html`<div class="block-s">
    <p class="muted">${t("Quien no está aquí trabaja de lunes a viernes, 8 h por día. Los días fuera de su horario no se exigen; si registra horas ahí, se marca como horas en día libre.")}</p>
    <table class="tbl"><thead><tr><th>${t("Persona")}</th><th>${t("Días que trabaja")}</th><th>${t("Nota")}</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.id}><td>${r.full_name}${!enBamboo.has(norm(r.full_name)) && html` <span class="pill hb-warn" title=${t("No coincide con ningún nombre de Bamboo")}>${t("no está en Bamboo")}</span>`}</td>
        <td>${rangoTxt(r.days)}</td><td class="small muted">${r.note}</td>
        <td class="right"><button class="link small" onClick=${() => { setNombre(r.full_name); setDias(r.days); setNota(r.note ?? ""); }}>${t("Editar")}</button>
          <button class="link small late-t" onClick=${async () => { if (confirm(t("¿Quitar el horario de {n}?", { n: r.full_name }))) { await api.remove("rule_schedules", r.id); reloadBamboo(); } }}>${t("Quitar")}</button></td></tr>`)}</tbody></table>
    <form class="hb-form stack-s mt" onSubmit=${guardar}>
      <h3>${t("Agregar o cambiar horario")}</h3>
      <div class="row">
        <label class="grow">${t("Persona (como está en Bamboo)")}<input list="bb-nombres" value=${nombre} onInput=${(e) => setNombre(e.target.value)} placeholder="Erika Ojeda" /></label>
        <label class="grow">${t("Nota")}<input value=${nota} onInput=${(e) => setNota(e.target.value)} placeholder=${t("Ej.: acuerdo con el cliente")} /></label>
      </div>
      <div class="row hb-days">${DIA_OPC.map((d) => html`<label class="check"><input type="checkbox" checked=${dias.includes(d)} onChange=${() => toggle(d)} />${DIAS[d]}</label>`)}</div>
      <div class="row end"><button class="primary">${t("Guardar horario")}</button></div>
    </form>
    <datalist id="bb-nombres">${nombres.map((n) => html`<option value=${n} />`)}</datalist>
  </div>`;
}

function Feriados() {
  const { bamboo, api, reloadBamboo } = useApp();
  const rows = bamboo.rules?.holidays ?? [];
  const [abierto, setAbierto] = useState(null);
  const [nuevoPais, setNuevoPais] = useState("");
  const [todos, setTodos] = useState(false);
  const anio = hoyLocal().slice(0, 4);
  const gente = new Map();
  for (const e of bamboo.employees ?? []) if (e.country && e.supervisor_id) {      // sin contar a Gus
    if (!gente.has(e.country)) gente.set(e.country, []);
    gente.get(e.country).push(e.full_name);
  }
  const porPais = new Map();
  for (const r of rows) { if (!porPais.has(r.country)) porPais.set(r.country, []); porPais.get(r.country).push(r); }
  const paises = [...new Set([...gente.keys(), ...porPais.keys()])].sort((a, b) => (gente.get(b)?.length ?? 0) - (gente.get(a)?.length ?? 0) || a.localeCompare(b));
  return html`<div class="block-s">
    <p class="muted">${t("Feriados del calendario corporativo (pestaña Global Holidays). Cada persona usa los de su país en Bamboo. Medio día = se esperan 4 h.")}</p>
    <table class="tbl hb-paises"><thead><tr><th>${t("País")}</th><th class="right">${t("Personas")}</th><th class="right">${t("Feriados {y}", { y: anio })}</th><th></th></tr></thead>
      <tbody>${paises.filter((p) => todos || gente.has(p) || abierto === p).map((p) => {
        const fs = (porPais.get(p) ?? []).sort((a, b) => a.day.localeCompare(b.day));
        const n = gente.get(p)?.length ?? 0;
        const nAnio = fs.filter((f) => f.day.startsWith(anio)).length;
        return html`<tr key=${p} class=${n && !nAnio ? "hb-alert" : ""}><td><strong>${titulo(p)}</strong>${n && !nAnio ? html` <span class="pill hb-bad">${t("sin feriados")}</span>` : ""}</td>
          <td class="right" title=${(gente.get(p) ?? []).join(", ")}>${n}</td><td class="right">${nAnio}</td>
          <td class="right"><button class="link small" onClick=${() => setAbierto(abierto === p ? null : p)}>${abierto === p ? t("Cerrar") : t("Ver y editar")}</button></td></tr>
          ${abierto === p && html`<tr><td colspan="4"><${FeriadosPais} pais=${p} fs=${fs} gente=${gente.get(p) ?? []} /></td></tr>`}`;
      })}</tbody></table>
    ${paises.some((p) => !gente.has(p)) && html`<p class="small"><button class="link small" onClick=${() => setTodos(!todos)}>${todos ? t("Mostrar solo países con personas") : t("Mostrar también países sin personas ({n})", { n: paises.filter((p) => !gente.has(p)).length })}</button></p>`}
    <form class="row mt" onSubmit=${(e) => { e.preventDefault(); if (nuevoPais.trim()) { setAbierto(norm(nuevoPais)); setNuevoPais(""); } }}>
      <label class="grow">${t("Agregar país")}<input value=${nuevoPais} onInput=${(e) => setNuevoPais(e.target.value)} placeholder=${t("Ej.: Venezuela (como figura en Bamboo)")} /></label>
      <button>${t("Agregar")}</button>
    </form>
    ${abierto && !paises.includes(abierto) && html`<div class="mt"><${FeriadosPais} pais=${abierto} fs=${[]} gente=${[]} /></div>`}
  </div>`;
}

function FeriadosPais({ pais, fs, gente }) {
  const { api, reloadBamboo } = useApp();
  const [dia, setDia] = useState("");
  const [nombre, setNombre] = useState("");
  const [medio, setMedio] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!dia || !nombre.trim()) return toast(t("Pon la fecha y el nombre."), "bad");
    try {
      const ex = fs.find((f) => f.day === dia);
      if (ex) await api.update("rule_holidays", ex.id, { name: nombre.trim(), fraction: medio ? 0.5 : 1 });
      else await api.insert("rule_holidays", [{ country: norm(pais), day: dia, name: nombre.trim(), fraction: medio ? 0.5 : 1 }]);
      setDia(""); setNombre(""); setMedio(false); toast(t("Feriado guardado")); reloadBamboo();
    } catch (x) { toast(x.message, "bad"); }
  };
  return html`<div class="hb-fer">
    ${gente.length > 0 && html`<p class="small muted">${t("Personas")}: ${gente.join(", ")}</p>`}
    ${fs.length ? html`<ul class="hb-list">${fs.map((f) => html`<li class="row between small" key=${f.id}>
      <span><b>${larga(f.day)}</b>${f.day.slice(0, 4) !== hoyLocal().slice(0, 4) ? ` ${f.day.slice(0, 4)}` : ""} · ${f.name}${Number(f.fraction) < 1 ? html` <span class="pill">${t("medio día")}</span>` : ""}</span>
      <span><button class="link small" onClick=${() => { setDia(f.day); setNombre(f.name); setMedio(Number(f.fraction) < 1); }}>${t("Editar")}</button>
        <button class="link small late-t" onClick=${async () => { if (confirm(t("¿Quitar {n}?", { n: f.name }))) { await api.remove("rule_holidays", f.id); reloadBamboo(); } }}>${t("Quitar")}</button></span></li>`)}</ul>`
      : html`<p class="small muted">${t("No hay feriados cargados para este país.")}</p>`}
    <form class="row" onSubmit=${add}>
      <label>${t("Fecha")}<input type="date" value=${dia} onInput=${(e) => setDia(e.target.value)} /></label>
      <label class="grow">${t("Nombre")}<input value=${nombre} onInput=${(e) => setNombre(e.target.value)} /></label>
      <label class="check"><input type="checkbox" checked=${medio} onChange=${(e) => setMedio(e.target.checked)} />${t("Medio día")}</label>
      <button class="primary">${t("Guardar feriado")}</button>
    </form>
  </div>`;
}

function Excluidos() {
  const { bamboo, api, reloadBamboo } = useApp();
  const rows = [...(bamboo.rules?.excluded ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const [nombre, setNombre] = useState("");
  const [nota, setNota] = useState("");
  const nombres = [...(bamboo.employees ?? [])].map((e) => e.full_name).sort();
  const add = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    try { await api.insert("rule_excluded", [{ full_name: nombre.trim(), note: nota || null }]); setNombre(""); setNota(""); toast(t("Excluido")); reloadBamboo(); }
    catch (x) { toast(x.message.includes("duplicate") ? t("Ya está en la lista.") : x.message, "bad"); }
  };
  return html`<div class="block-s">
    <p class="muted">${t("Personas que no se revisan (por ejemplo, ya no están o no registran horas). Quien sale de Bamboo como inactivo se quita solo.")}</p>
    <table class="tbl"><tbody>${rows.map((r) => html`<tr key=${r.id}><td>${r.full_name}</td><td class="small muted">${r.note}</td>
      <td class="right"><button class="link small late-t" onClick=${async () => { await api.remove("rule_excluded", r.id); reloadBamboo(); toast(t("Vuelve a revisarse en la próxima actualización")); }}>${t("Quitar")}</button></td></tr>`)}</tbody></table>
    <form class="row mt" onSubmit=${add}>
      <label class="grow">${t("Nombre (como está en Bamboo)")}<input list="bb-nombres2" value=${nombre} onInput=${(e) => setNombre(e.target.value)} /></label>
      <label class="grow">${t("Motivo")}<input value=${nota} onInput=${(e) => setNota(e.target.value)} /></label>
      <button class="primary">${t("Excluir")}</button>
    </form>
    <datalist id="bb-nombres2">${nombres.map((n) => html`<option value=${n} />`)}</datalist>
  </div>`;
}

function Config() {
  const { bamboo, api, reloadBamboo } = useApp();
  const cfg = Object.fromEntries((bamboo.rules?.config ?? []).map((r) => [r.key, r.value]));
  const [proy, setProy] = useState((cfg.main_projects ?? ["DDC"]).join(", "));
  const [horas, setHoras] = useState(String(cfg.hours_per_day ?? 8));
  const [limite, setLimite] = useState(String(cfg.deadline_hour ?? 8));
  const guardar = async (e) => {
    e.preventDefault();
    const lista = proy.split(",").map((x) => x.trim()).filter(Boolean);
    if (!lista.length) return toast(t("Pon al menos un proyecto principal."), "bad");
    try {
      await api.upsert("rule_config", [
        { key: "main_projects", value: lista },
        { key: "hours_per_day", value: Number(horas) || 8 },
        { key: "deadline_hour", value: Math.min(Math.max(Number(limite) || 8, 0), 23) },
      ]);
      toast(t("Configuración guardada")); reloadBamboo();
    } catch (x) { toast(x.message, "bad"); }
  };
  return html`<form class="block-s stack hb-form" onSubmit=${guardar}>
    <label>${t("Proyecto principal (palabras, separadas por coma)")}<input value=${proy} onInput=${(e) => setProy(e.target.value)} />
      <span class="small muted">${t("Cuentan las horas de cualquier proyecto cuyo nombre contenga alguna de estas palabras (DDC = COX DDC MS, DDC, DDC Soporte). Lo demás sale como proyecto adicional y no cuenta.")}</span></label>
    <div class="row">
      <label>${t("Horas por día")}<input type="number" min="1" max="12" step="0.5" value=${horas} onInput=${(e) => setHoras(e.target.value)} /></label>
      <label>${t("Hora límite del lunes")}<input type="number" min="0" max="23" value=${limite} onInput=${(e) => setLimite(e.target.value)} /></label>
    </div>
    <p class="small muted">${t("Sin margen: el registro tiene que ser exactamente las horas del día; más o menos genera alerta.")}</p>
    <div class="row end"><button class="primary">${t("Guardar")}</button></div>
  </form>`;
}

export const __test = { setNow: (ms) => { _now = ms; } };

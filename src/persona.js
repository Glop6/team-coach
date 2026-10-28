// =====================================================================
//  Cambio 20b: vistas de la persona del equipo (rol "member")
//  Mi espacio (resumen de hoy) y el detalle con historial:
//  incidencias, reuniones, pendientes y notas de su líder.
//  Las horas y el desarrollo viven en bamboo.js (MisHoras, MiDesarrollo).
//  Todo lo que llega acá ya viene filtrado por la base de datos (RLS): solo lo suyo.
// =====================================================================
import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";
import { useApp, t, getLang, srv, Tx, TxCat, txAhora, Empty, fmtDate, today, firstName, Avatar, ActionTable, NoteItem, MEETING_KIND, OPEN, isOverdue } from "./app.js";
import { BambooPersonBlock } from "./bamboo.js";
import { IncidentRow, esMia, nuevas, vistoDesde, SevPill, esKudos, KudosPill } from "./incidencias.js";

const html = htm.bind(h);
const mesDe = (d) => String(d ?? "").slice(0, 7);
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const nombreMes = (ym) => {
  const m = Number(ym.slice(5, 7)) - 1;
  const n = (getLang() === "en" ? MESES_EN : MESES_ES)[m] ?? ym;
  return n.charAt(0).toUpperCase() + n.slice(1) + " " + ym.slice(0, 4);
};

function usarPersona() {
  const ctx = useApp();
  const p = ctx.idx.person(ctx.me?.person_id);
  return { ctx, p, g: p ? ctx.idx.group(p.group_id) : null };
}

function SinPerfil({ titulo }) {
  return html`<section class="page narrow"><h1>${titulo}</h1><${Empty}>${t("Tu usuario todavía no está vinculado a tu perfil. Avísale a Gus.")}<//></section>`;
}

const VerTodo = ({ href, children }) => html`<a class="small ver-todo" href=${href}>${children ?? t("Ver todo")} →</a>`;

// ---------------------------------------------------------------------
// Mi espacio: resumen de hoy
// ---------------------------------------------------------------------
export function MiEspacio() {
  const { ctx, p, g } = usarPersona();
  const { data } = ctx;
  if (!p) return html`<${SinPerfil} titulo=${t("Mi espacio")} />`;
  const abiertos = data.actions.filter((a) => a.owner_id === p.id && OPEN.includes(a.status)).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const vencidos = abiertos.filter(isOverdue).length;
  const mes = today().slice(0, 7);
  const incs = (data.incidents ?? []).filter((i) => esMia(ctx, i)).sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at).localeCompare(String(a.created_at)));
  const incMes = incs.filter((i) => !i.voided && !esKudos(i) && mesDe(i.occurred_on) === mes);
  const kudosMes = incs.filter((i) => !i.voided && esKudos(i) && mesDe(i.occurred_on) === mes);
  const nuevasN = nuevas(ctx).filter((i) => esMia(ctx, i)).length;
  const reus = data.my_meetings ?? [];
  const ultima = reus.find((m) => m.status === "aplicado") ?? reus[0];
  const notas = data.insights.filter((i) => i.person_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return html`<section class="page person mi" style=${`--c:${g?.color ?? "#64748b"}`}>
    <header class="person-head">
      <${Avatar} person=${p} group=${g} size="xl" />
      <div class="grow">
        <h1>${t("Hola, {n}", { n: firstName(p.nickname || p.full_name) })}</h1>
        <p class="muted">${[p.title, g?.name].filter(Boolean).join(", ")}</p>
        <p class="small muted">${t("Este es tu espacio: solo tú (y tu líder) ven esta información.")}</p>
      </div>
    </header>
    <div class="pulse">
      <a href="#/pendientes" class=${"pulse-item" + (vencidos ? " alert" : "")}><strong>${abiertos.length}</strong> ${abiertos.length === 1 ? t("pendiente abierto") : t("pendientes abiertos")}${vencidos ? html` · <span class="late-t">${t("{n} vencidos", { n: vencidos })}</span>` : ""}</a>
      <a href="#/incidencias" class="pulse-item kudos-pulse"><strong>${kudosMes.length}</strong> ${t("kudos este mes")}</a>
      <a href="#/incidencias" class=${"pulse-item" + (incMes.length ? " alert" : "")}><strong>${incMes.length}</strong> ${t("incidencias este mes")}</a>
      <a href="#/reuniones" class="pulse-item"><strong>${reus.length}</strong> ${reus.length === 1 ? t("reunión") : t("reuniones")}</a>
    </div>

    <${BambooPersonBlock} person=${p} />

    <div class="mi-grid">
      <section class="mi-card">
        <div class="row between"><h2>${t("Mis pendientes")}</h2><${VerTodo} href="#/pendientes" /></div>
        ${abiertos.length ? html`<ul class="mi-mini">${abiertos.slice(0, 4).map((a) => html`<li key=${a.id} class=${isOverdue(a) ? "late" : ""}>
            <span><${Tx} s=${a.body} /></span><span class="small muted">${a.due_date ? (isOverdue(a) ? t("Venció {d}", { d: fmtDate(a.due_date) }) : t("Para el {d}", { d: fmtDate(a.due_date) })) : t("Sin fecha")}</span></li>`)}</ul>
          ${abiertos.length > 4 && html`<p class="small muted">${t("y {n} más", { n: abiertos.length - 4 })}</p>`}`
          : html`<p class="muted small">${t("No tienes pendientes abiertos.")}</p>`}
      </section>
      <section class="mi-card">
        <div class="row between"><h2>${t("Incidencias y kudos")}${nuevasN > 0 && html` <span class="pill new-pill">${t("{n} nuevas", { n: nuevasN })}</span>`}</h2><${VerTodo} href="#/incidencias" /></div>
        ${incs.filter((i) => !i.voided).length ? html`<ul class="mi-mini">${incs.filter((i) => !i.voided).slice(0, 3).map((i) => html`<li key=${i.id} class=${esKudos(i) ? "kudos" : ""}>
            <span>${esKudos(i) ? html`<${KudosPill} /> ` : ""}<${TxCat} c=${i.category} /> ${!esKudos(i) && html`<${SevPill} s=${i.severity} />`}</span><span class="small muted">${fmtDate(i.occurred_on)}${i.note || i.detail ? " · " + (txAhora(i.note) || srv(i.detail)) : ""}</span></li>`)}</ul>`
          : html`<p class="muted small">${t("Sin registros todavía.")}</p>`}
      </section>
      <section class="mi-card">
        <div class="row between"><h2>${t("Última reunión")}</h2><${VerTodo} href="#/reuniones" /></div>
        ${ultima ? html`<p class="small"><b>${t(MEETING_KIND[ultima.kind] ?? "Reunión")} · ${fmtDate(ultima.meeting_date)}</b></p>
            ${ultima.summary ? html`<p class="small clamp-3"><${Tx} s=${ultima.summary} /></p>` : html`<p class="small muted">${t("El resumen aparece cuando tu líder termine de revisarla.")}</p>`}
            ${(ultima.acuerdos ?? []).length > 0 && html`<p class="small muted">${t("{h} de {n} acuerdos hechos", { n: ultima.acuerdos.length, h: ultima.acuerdos.filter((a) => a.status === "hecho").length })}</p>`}`
          : html`<p class="muted small">${t("Todavía no hay reuniones registradas.")}</p>`}
      </section>
      <section class="mi-card">
        <div class="row between"><h2>${t("Notas de tu líder")}</h2><${VerTodo} href="#/notas" /></div>
        ${notas.length ? html`<ul class="mi-mini">${notas.slice(0, 2).map((i) => html`<li key=${i.id}><span class="clamp-3"><${Tx} s=${i.body} /></span><span class="small muted">${fmtDate(String(i.created_at).slice(0, 10))}</span></li>`)}</ul>`
          : html`<p class="muted small">${t("Tu líder todavía no compartió notas contigo.")}</p>`}
      </section>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------
// Mis incidencias: historial por mes
// ---------------------------------------------------------------------
export function MisIncidencias() {
  const { ctx, p } = usarPersona();
  const { data } = ctx;
  const [mes, setMes] = useState("todos");
  const [tipo, setTipo] = useState("todo");
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [desde] = useState(() => vistoDesde(ctx, "incidents"));
  useEffect(() => { if (!data.incidents_error) ctx.markSeen?.("incidents"); }, []);
  if (!p) return html`<${SinPerfil} titulo=${t("Mis incidencias")} />`;
  const incs = (data.incidents ?? []).filter((i) => esMia(ctx, i));
  const nuevasIds = new Set(nuevas(ctx, desde).map((i) => i.id));
  const meses = [...new Set([today().slice(0, 7), ...incs.map((i) => mesDe(i.occurred_on))])].sort().reverse();
  const resumen = meses.map((m) => { const xs = incs.filter((i) => !i.voided && mesDe(i.occurred_on) === m); const ins = xs.filter((i) => !esKudos(i));
    return { m, n: ins.length, crit: ins.filter((i) => i.severity === "critica").length, auto: ins.filter((i) => i.source === "bamboo").length, kudos: xs.filter(esKudos).length }; });
  const max = Math.max(1, ...resumen.map((r) => r.n));
  const lista = incs.filter((i) => (mes === "todos" || mesDe(i.occurred_on) === mes) && (verAnuladas || !i.voided)
    && (tipo === "todo" || (tipo === "kudos" ? esKudos(i) : !esKudos(i))));
  const anuladas = incs.filter((i) => i.voided && (mes === "todos" || mesDe(i.occurred_on) === mes)).length;
  return html`<section class="page">
    <header class="page-head"><div><h1>${t("Incidencias y kudos")}</h1>
      <p class="muted">${t("Lo que se registró sobre ti: lo que hiciste bien (kudos) y lo que hay que mejorar, para conversarlo con tu líder. Si algo no está bien, háblalo con tu líder o con Gus.")}</p></div></header>
    ${nuevasIds.size > 0 && html`<p class="inc-new-note small"><span class="pill new-pill">${t("Nueva")}</span> ${nuevasIds.size === 1 ? t("1 registro nuevo desde tu última visita.") : t("{n} registros nuevos desde tu última visita.", { n: nuevasIds.size })}</p>`}
    ${incs.length > 0 && html`<table class="tbl inc-meses"><thead><tr><th>${t("Mes")}</th><th class="grow-col"></th><th class="right">${t("Kudos")}</th><th class="right">${t("Incidencias")}</th><th class="right">${t("Críticas")}</th><th class="right">${t("Bamboo")}</th></tr></thead>
      <tbody>${resumen.map((r) => html`<tr key=${r.m} class=${mes === r.m ? "on" : ""} onClick=${() => setMes(mes === r.m ? "todos" : r.m)}>
        <td>${nombreMes(r.m)}</td><td class="grow-col"><span class="bar"><i style=${`width:${(100 * r.n) / max}%`}></i></span></td>
        <td class="right kudos-t">${r.kudos ? "★ " + r.kudos : "—"}</td><td class="right"><b>${r.n}</b></td><td class="right">${r.crit || "—"}</td><td class="right">${r.auto || "—"}</td></tr>`)}</tbody></table>`}
    <div class="row hb-bar mt">
      <select class="mini" value=${mes} onChange=${(e) => setMes(e.target.value)} aria-label=${t("Mes")}>
        <option value="todos">${t("Todos los meses")}</option>${meses.map((m) => html`<option value=${m}>${nombreMes(m)}</option>`)}</select>
      <div class="seg">${[["todo", t("Todo")], ["kudos", t("Kudos")], ["inc", t("Incidencias")]].map(([k, l]) => html`<button class=${tipo === k ? "on" : ""} aria-pressed=${tipo === k} onClick=${() => setTipo(k)}>${l}</button>`)}</div>
      <label class="check small"><input type="checkbox" checked=${verAnuladas} onChange=${(e) => setVerAnuladas(e.target.checked)} />${t("Ver anuladas ({n})", { n: anuladas })}</label>
    </div>
    ${lista.length ? html`<ul class="inc-list">${lista.map((i) => html`<${IncidentRow} inc=${i} key=${i.id} showPerson=${false} nueva=${nuevasIds.has(i.id)} />`)}</ul>`
      : html`<${Empty}>${mes === "todos" ? t("Sin registros todavía.") : t("No hay registros en este mes.")}<//>`}
  </section>`;
}

// ---------------------------------------------------------------------
// Mis reuniones: todas, con resumen y acuerdos
// ---------------------------------------------------------------------
export function MisReuniones() {
  const { ctx, p } = usarPersona();
  const [anio, setAnio] = useState("todos");
  if (!p) return html`<${SinPerfil} titulo=${t("Mis reuniones")} />`;
  const reus = ctx.data.my_meetings ?? [];
  const anios = [...new Set(reus.map((m) => String(m.meeting_date).slice(0, 4)))].sort().reverse();
  const lista = reus.filter((m) => anio === "todos" || String(m.meeting_date).startsWith(anio));
  const acuerdos = reus.flatMap((m) => m.acuerdos ?? []);
  return html`<section class="page narrow">
    <header class="page-head"><div><h1>${t("Mis reuniones")}</h1>
      <p class="muted">${t("Tus reuniones con tu líder: fecha, resumen y lo que acordaron. El resumen aparece cuando tu líder termina de revisarla.")}</p></div></header>
    <div class="row between hb-bar">
      <div class="pulse">
        <span class="pulse-item"><strong>${reus.length}</strong> ${reus.length === 1 ? t("reunión") : t("reuniones")}</span>
        <span class="pulse-item"><strong>${acuerdos.filter((a) => a.status === "hecho").length}/${acuerdos.length}</strong> ${t("acuerdos hechos")}</span>
      </div>
      ${anios.length > 1 && html`<select class="mini" value=${anio} onChange=${(e) => setAnio(e.target.value)} aria-label=${t("Año")}><option value="todos">${t("Todos")}</option>${anios.map((y) => html`<option value=${y}>${y}</option>`)}</select>`}
    </div>
    ${lista.length ? html`<ul class="mi-reus">${lista.map((m) => html`<li key=${m.id}>
        <div class="row between"><strong>${t(MEETING_KIND[m.kind] ?? "Reunión")} · ${fmtDate(m.meeting_date)}</strong>
          ${m.status !== "aplicado" && html`<span class="pill">${t("En revisión")}</span>`}</div>
        ${m.summary ? html`<p class="small"><${Tx} s=${m.summary} /></p>` : html`<p class="small muted">${t("El resumen aparece cuando tu líder termine de revisarla.")}</p>`}
        ${(m.acuerdos ?? []).length > 0 && html`<div class="mi-acuerdos"><span class="lbl">${t("Acuerdos")}</span><ul>${m.acuerdos.map((a) => html`<li class=${a.status === "hecho" ? "done" : ""} key=${a.id}>${a.status === "hecho" ? "✓ " : ""}<${Tx} s=${a.body} />${a.due_date ? html` <span class="muted small">· ${fmtDate(a.due_date)}</span>` : ""}</li>`)}</ul></div>`}
      </li>`)}</ul>` : html`<${Empty}>${t("Todavía no hay reuniones registradas.")}<//>`}
  </section>`;
}

// ---------------------------------------------------------------------
// Mis pendientes: abiertos y completados, con comentarios
// ---------------------------------------------------------------------
export function MisPendientes() {
  const { ctx, p } = usarPersona();
  const [tab, setTab] = useState("abiertos");
  const [mes, setMes] = useState("todos");
  if (!p) return html`<${SinPerfil} titulo=${t("Mis pendientes")} />`;
  const mios = ctx.data.actions.filter((a) => a.owner_id === p.id);
  const abiertos = mios.filter((a) => OPEN.includes(a.status)).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const cuando = (a) => mesDe(a.done_at ?? a.due_date ?? a.created_at);
  const cerrados = mios.filter((a) => !OPEN.includes(a.status)).sort((a, b) => String(b.done_at ?? b.due_date ?? b.created_at ?? "").localeCompare(String(a.done_at ?? a.due_date ?? a.created_at ?? "")));
  const meses = [...new Set(cerrados.map(cuando).filter(Boolean))].sort().reverse();
  const lista = tab === "abiertos" ? abiertos : cerrados.filter((a) => mes === "todos" || cuando(a) === mes);
  return html`<section class="page">
    <header class="page-head"><div><h1>${t("Mis pendientes")}</h1>
      <p class="muted">${t("Las tareas que tienes a cargo. Márcalas cuando las termines y deja un comentario si hace falta.")}</p></div></header>
    <div class="row hb-bar">
      <div class="seg" role="tablist">
        <button role="tab" aria-selected=${tab === "abiertos"} class=${tab === "abiertos" ? "on" : ""} onClick=${() => setTab("abiertos")}>${t("Abiertos ({n})", { n: abiertos.length })}</button>
        <button role="tab" aria-selected=${tab === "cerrados"} class=${tab === "cerrados" ? "on" : ""} onClick=${() => setTab("cerrados")}>${t("Completados ({n})", { n: cerrados.length })}</button>
      </div>
      ${tab === "cerrados" && meses.length > 0 && html`<select class="mini" value=${mes} onChange=${(e) => setMes(e.target.value)} aria-label=${t("Mes")}>
        <option value="todos">${t("Todos los meses")}</option>${meses.map((m) => html`<option value=${m}>${nombreMes(m)}</option>`)}</select>`}
    </div>
    <${ActionTable} actions=${lista} mine=${true} empty=${tab === "abiertos" ? t("No tienes pendientes abiertos.") : t("Todavía no hay tareas completadas.")} />
  </section>`;
}

// ---------------------------------------------------------------------
// Notas de mi líder (solo las que marcó como visibles)
// ---------------------------------------------------------------------
export function MisNotas() {
  const { ctx, p } = usarPersona();
  if (!p) return html`<${SinPerfil} titulo=${t("Notas de mi líder")} />`;
  const notas = ctx.data.insights.filter((i) => i.person_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const porMes = [];
  for (const n of notas) { const m = mesDe(n.created_at); let b = porMes.find((x) => x.m === m); if (!b) porMes.push((b = { m, items: [] })); b.items.push(n); }
  return html`<section class="page narrow">
    <header class="page-head"><div><h1>${t("Notas de mi líder")}</h1>
      <p class="muted">${t("Las notas que tu líder decidió compartir contigo: fortalezas, avances y temas a trabajar.")}</p></div></header>
    ${porMes.length ? porMes.map((b) => html`<section class="block" key=${b.m}><h2 class="small-h">${nombreMes(b.m)}</h2>
        <ol class="timeline">${b.items.map((i) => html`<li key=${i.id}><div class="tl-date">${fmtDate(String(i.created_at).slice(0, 10))}</div><${NoteItem} i=${i} /></li>`)}</ol></section>`)
      : html`<${Empty}>${t("Tu líder todavía no compartió notas contigo.")}<//>`}
  </section>`;
}

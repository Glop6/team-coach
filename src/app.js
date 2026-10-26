import { h, render, createContext } from "preact";
import { useState, useEffect, useContext, useMemo, useCallback } from "preact/hooks";
import htm from "htm";
import { EN } from "./i18n.js";
import { organize, TEMPLATE_ONE, TEMPLATE_GROUP } from "./organize.js";
import { HorasView, ReglasView, BambooPersonBlock } from "./bamboo.js";

const html = htm.bind(h);
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// ---------------------------------------------------------------------
// Idioma (Cambio 6). Las claves son el texto en español.
// ---------------------------------------------------------------------
let LANG = "es";
try { LANG = localStorage.getItem("tc-lang") || "es"; } catch (_) {}
export const t = (s, vars) => {
  let out = LANG === "en" ? EN[s] ?? s : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => localISO(new Date());
const initials = (n = "") => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const firstName = (n = "") => n.split(" ")[0];
const MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  const mon = MONTHS[LANG][Number(m) - 1];
  const yr = y !== today().slice(0, 4) ? ` ${y}` : "";
  return LANG === "en" ? `${mon} ${Number(day)}${yr}` : `${Number(day)} ${mon}${yr}`;
};
const daysUntil = (d) => Math.round((new Date(d + "T12:00:00") - new Date(today() + "T12:00:00")) / 86400000);
const OPEN = ["pendiente", "en curso", "pausado"];
const STATUSES = ["pendiente", "en curso", "pausado", "hecho", "cancelado"];
const PRIORITIES = ["alta", "media", "baja"];
const KIND_LABEL = { fortaleza: "Fortaleza", "a mejorar": "A mejorar", observación: "Observación", avance: "Avance", retroceso: "Retroceso" };
const KIND_ORDER = ["a mejorar", "fortaleza", "observación", "avance", "retroceso"];
const MEETING_KIND = { "1-1": "1:1", mensual: "Mensual", grupal: "Grupal", otro: "Otra" };
const CATS = ["comunicación", "asertividad", "cómo preguntar", "proactividad", "autonomía", "actitud", "técnico", "calidad", "procesos", "organización", "inglés", "liderazgo", "comunicación con cliente", "crecimiento"];
const go = (path) => (location.hash = path);
// Cambio 10: ordenar notas sin IA y dejarlas listas para revisar
async function organizeMeeting(api, data, idx, m) {
  const analysis = organize(m.transcript ?? "", { meetingPerson: idx.person(m.person_id), people: data.people, isLead: idx.isLead, today: today() });
  if (m.analysis?.coaching?.length) analysis.coaching = m.analysis.coaching;
  await api.update("meetings", m.id, { analysis, summary: analysis.summary, status: "analizado" });
}
const isOverdue = (a) => a.due_date && OPEN.includes(a.status) && daysUntil(a.due_date) < 0;
// Semáforo (Cambio 5): rojo = vencido o prioridad alta; amarillo = media; verde = baja
const light = (a) => (isOverdue(a) || a.priority === "alta" ? "r" : a.priority === "baja" ? "g" : "y");
const words = ["Condor", "Illimani", "Titicaca", "Puma", "Salar", "Yungas", "Tunari", "Sajama", "Uyuni", "Chaco", "Vicuna", "Huayna", "Chacaltaya", "Amboro", "Madidi"];
const genPassword = () => {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${words[r[0] % words.length]}-${1000 + (r[1] % 9000)}`;
};

function useRoute() {
  const [hash, setHash] = useState(location.hash || "#/equipo");
  useEffect(() => {
    const f = () => { setHash(location.hash || "#/equipo"); window.scrollTo(0, 0); };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  const parts = hash.replace(/^#\/?/, "").split("/");
  return { page: parts[0] || "equipo", id: parts[1] };
}

// Toasts
let pushToast = () => {};
function Toasts() {
  const [items, setItems] = useState([]);
  pushToast = (text, kind = "ok") => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  };
  return html`<div class="toasts" role="status" aria-live="polite">
    ${items.map((x) => html`<div class=${"toast " + x.kind} key=${x.id}>${x.text}</div>`)}
  </div>`;
}
export const toast = (x, k) => pushToast(x, k);

// Índices y reglas sobre los datos
function buildIdx(data) {
  const m = (arr) => new Map(arr.map((x) => [x.id, x]));
  const P = m(data.people), G = m(data.groups), M = m(data.meetings);
  const leadIds = new Set([...data.group_leads.map((l) => l.person_id), ...(data.lead_ids ?? [])]);
  data.people.forEach((p) => p.is_lead && leadIds.add(p.id));
  const primaryLeadOfGroup = (gid) => data.group_leads.find((l) => l.group_id === gid && l.is_primary)?.person_id ?? data.group_leads.find((l) => l.group_id === gid)?.person_id ?? null;
  return {
    person: (id) => P.get(id),
    group: (id) => G.get(id),
    meeting: (id) => M.get(id),
    isLead: (id) => !!id && leadIds.has(id),
    leadOf: (pid) => { const p = P.get(pid); return p ? primaryLeadOfGroup(p.group_id) : null; },
    groupsLedBy: (pid) => data.group_leads.filter((l) => l.person_id === pid).map((l) => G.get(l.group_id)).filter(Boolean),
  };
}
const isActive = (p) => p.status === "activo" || p.status === "pausado";

// ---------------------------------------------------------------------
// Piezas pequeñas
// ---------------------------------------------------------------------
function Avatar({ person, group, size = "md" }) {
  const color = group?.color ?? "#64748b";
  return html`<span class=${"avatar " + size} style=${`--c:${color}`} aria-hidden="true">${initials(person?.full_name)}</span>`;
}

export function PersonLink({ id }) {
  const { idx } = useApp();
  const p = idx.person(id);
  if (!p) return html`<span class="muted">—</span>`;
  return html`<a href=${"#/persona/" + p.id} class="plink">${p.full_name}</a>`;
}

const slug = (s) => s.replace(/\s/g, "-").normalize("NFD").replace(/[̀-ͯ]/g, "");
function Kind({ kind }) {
  return html`<span class=${"kind k-" + slug(kind)}>${t(KIND_LABEL[kind] ?? kind)}</span>`;
}

function Due({ date, status }) {
  if (!date) return html`<span class="muted small">—</span>`;
  const d = daysUntil(date);
  const done = !OPEN.includes(status ?? "pendiente");
  const cls = done ? "due" : d < 0 ? "due late" : d <= 2 ? "due soon" : "due";
  const txt = done ? fmtDate(date) : d < 0 ? t("Venció {d}", { d: fmtDate(date) }) : d === 0 ? t("Hoy") : d === 1 ? t("Mañana") : fmtDate(date);
  return html`<span class=${cls}>${txt}</span>`;
}

function PriorityPill({ a }) {
  return html`<span class=${"prio pr-" + light(a)}>${t(a.priority ?? "media")}</span>`;
}

export function Busy({ label }) {
  return html`<div class="busy"><span class="spinner" aria-hidden="true"></span>${label ?? t("Cargando…")}</div>`;
}

export function Empty({ children }) {
  return html`<p class="empty">${children}</p>`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const f = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label=${title}>
      <header><h2>${title}</h2><button class="icon" onClick=${onClose} aria-label=${t("Cerrar")}>✕</button></header>
      ${children}
    </div>
  </div>`;
}

function PersonSelect({ value, onChange, allowEmpty, only, includeInactive }) {
  const { data, idx } = useApp();
  const groups = [...data.groups].sort((a, b) => a.sort - b.sort);
  const people = (only ? data.people.filter(only) : data.people).filter((p) => includeInactive || isActive(p) || p.id === value);
  const empty = allowEmpty === undefined ? "—" : allowEmpty;
  return html`<select value=${value ?? ""} onChange=${(e) => onChange(e.target.value || null)}>
    ${empty !== false && html`<option value="">${empty}</option>`}
    ${groups.map((g) => {
      const ps = people.filter((p) => p.group_id === g.id).sort((a, b) => idx.isLead(b.id) - idx.isLead(a.id) || a.full_name.localeCompare(b.full_name));
      return ps.length ? html`<optgroup label=${g.name}>${ps.map((p) => html`<option value=${p.id}>${p.full_name}${idx.isLead(p.id) ? ` (${t("lead")})` : ""}</option>`)}</optgroup>` : null;
    })}
    ${people.filter((p) => !idx.group(p.group_id)).map((p) => html`<option value=${p.id}>${p.full_name}</option>`)}
  </select>`;
}

// ---------------------------------------------------------------------
// Login (Cambio 9: sin franjas; un grupo de círculos que se superponen)
// ---------------------------------------------------------------------
const TEAM_COLORS = ["#3456a3", "#0e8aa8", "#2e8b6e", "#d99a1e", "#c2416b", "#7a4fb5", "#b4643c"];
function Constellation() {
  const pts = [[150, 120, 74], [250, 92, 52], [300, 190, 64], [205, 250, 58], [100, 230, 46], [325, 300, 40], [180, 340, 34]];
  return html`<svg class="constellation" viewBox="0 0 420 420" aria-hidden="true">
    ${pts.map(([x, y, r], i) => html`<circle cx=${x} cy=${y} r=${r} fill=${TEAM_COLORS[i]} />`)}
  </svg>`;
}

function Login({ api, onLang }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await api.signIn(email.trim(), pw); } catch (x) { setErr(t(x.message)); }
    setBusy(false);
  };
  return html`<main class="login">
    <div class="login-art"><${Constellation} /></div>
    <form class="login-card" onSubmit=${submit}>
      <h1>Team Coach</h1>
      <p class="muted">${t("Lo que hablamos, lo que funciona y lo que sigue, para cada persona del equipo.")}</p>
      <label>${t("Correo")}<input type="email" autocomplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
      <label>${t("Contraseña")}<input type="password" autocomplete="current-password" required value=${pw} onInput=${(e) => setPw(e.target.value)} /></label>
      ${err && html`<p class="error">${err}</p>`}
      <button class="primary" disabled=${busy}>${busy ? t("Entrando…") : t("Entrar")}</button>
      <${LangSwitch} onLang=${onLang} />
    </form>
  </main>`;
}

function LangSwitch({ onLang }) {
  return html`<span class="seg lang" role="group" aria-label="Idioma / Language">
    <button type="button" class=${LANG === "es" ? "on" : ""} onClick=${() => onLang("es")}>Español</button>
    <button type="button" class=${LANG === "en" ? "on" : ""} onClick=${() => onLang("en")}>English</button>
  </span>`;
}

function ChangePassword({ onClose }) {
  const { api } = useApp();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [err, setErr] = useState("");
  const save = async (e) => {
    e.preventDefault();
    if (a.length < 8) return setErr(t("Usa al menos 8 caracteres."));
    if (a !== b) return setErr(t("Las contraseñas no coinciden."));
    try { await api.changePassword(a); toast(t("Contraseña cambiada")); onClose(); } catch (x) { setErr(x.message); }
  };
  return html`<${Modal} title=${t("Cambiar contraseña")} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <p class="muted small">${t("Es opcional. Si no la cambias, sigues entrando con la que te dio Gus.")}</p>
      <label>${t("Nueva contraseña")}<input type="password" autocomplete="new-password" value=${a} onInput=${(e) => setA(e.target.value)} /></label>
      <label>${t("Repítela")}<input type="password" autocomplete="new-password" value=${b} onInput=${(e) => setB(e.target.value)} /></label>
      ${err && html`<p class="error">${err}</p>`}
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary">${t("Cambiar contraseña")}</button></div>
    </form>
  <//>`;
}

// ---------------------------------------------------------------------
// Equipo (organigrama por grupos)
// ---------------------------------------------------------------------
function personStats(data, pid) {
  const open = data.actions.filter((a) => a.person_id === pid && OPEN.includes(a.status));
  const late = open.filter(isOverdue).length;
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const recent = data.insights.filter((i) => i.person_id === pid && i.created_at >= since);
  const up = recent.filter((i) => i.kind === "avance" || i.kind === "fortaleza").length;
  const down = recent.filter((i) => i.kind === "retroceso" || i.kind === "a mejorar").length;
  const inUse = data.suggestions.filter((s) => s.person_id === pid && s.status === "en uso").length;
  return { open: open.length, late, up, down, inUse, notes: recent.length };
}

function Chip({ p, g }) {
  const { data } = useApp();
  const s = personStats(data, p.id);
  return html`<a class=${"chip" + (!isActive(p) ? " dim" : "")} href=${"#/persona/" + p.id}>
    <${Avatar} person=${p} group=${g} size="sm" />
    <span class="chip-name">${p.full_name}${p.nickname ? html` <em>${p.nickname}</em>` : ""}</span>
    <span class="chip-meta">
      ${s.late > 0 && html`<b class="m-late" title=${t("Pendientes vencidos")}>${s.late}</b>`}
      ${s.open > 0 && html`<b class="m-open" title=${t("Pendientes abiertos")}>${s.open}</b>`}
      ${s.inUse > 0 && html`<b class="m-use" title=${t("Métodos en uso")}>${s.inUse}</b>`}
    </span>
  </a>`;
}

function TeamView() {
  const { data, isAdmin, me, idx, reviewsPending } = useApp();
  const [q, setQ] = useState("");
  const groups = [...data.groups].sort((a, b) => a.sort - b.sort);
  const match = (p) => !q || (p.full_name + " " + (p.nickname ?? "")).toLowerCase().includes(q.toLowerCase());
  // Cambio 8: los inactivos no aparecen para los leads
  const visible = (p) => isAdmin || isActive(p);
  const openAll = data.actions.filter((a) => OPEN.includes(a.status));
  const lateAll = openAll.filter(isOverdue);
  const toReview = data.suggestions.filter((s) => s.status === "propuesta").length + reviewsPending;
  const mine = me?.person_id ? idx.person(me.person_id) : null;
  const nActive = data.people.filter(isActive).length;

  return html`<section class="page">
    <header class="page-head">
      <div>
        <h1>${isAdmin ? t("Tu equipo") : t("Hola, {n}", { n: firstName(mine?.full_name ?? "") })}</h1>
        <p class="muted">${isAdmin ? t("{n} personas activas en {g} grupos.", { n: nActive, g: groups.length }) : t("Tu grupo, lo que acordamos y cómo va cada persona.")}</p>
      </div>
      <input class="search" type="search" placeholder=${t("Buscar persona")} value=${q} onInput=${(e) => setQ(e.target.value)} aria-label=${t("Buscar persona")} />
    </header>

    <div class="pulse">
      <a href="#/pendientes" class=${"pulse-item" + (lateAll.length ? " alert" : "")}><strong>${lateAll.length}</strong> ${lateAll.length === 1 ? t("vencido") : t("vencidos")}</a>
      <a href="#/pendientes" class="pulse-item"><strong>${openAll.length}</strong> ${openAll.length === 1 ? t("pendiente abierto") : t("pendientes abiertos")}</a>
      ${isAdmin && html`<a href="#/validar" class=${"pulse-item" + (toReview ? " gold" : "")}><strong>${toReview}</strong> ${t("por revisar")}</a>`}
      <a href="#/reuniones" class="pulse-item"><strong>${data.meetings.length}</strong> ${data.meetings.length === 1 ? t("reunión") : t("reuniones")}</a>
      <a href="#/ideas" class="pulse-item"><strong>${data.ideas.filter((i) => i.status !== "resuelta" && i.status !== "descartada").length}</strong> ${t("ideas abiertas")}</a>
    </div>

    <div class="legend muted"><span><b class="m-late"></b> ${t("vencidos")}</span><span><b class="m-open"></b> ${t("abiertos")}</span><span><b class="m-use"></b> ${t("métodos en uso")}</span></div>

    <div class="bands">
      ${groups.map((g) => {
        const lead = data.group_leads.filter((l) => l.group_id === g.id).sort((a, b) => b.is_primary - a.is_primary).map((l) => idx.person(l.person_id)).filter(Boolean);
        const members = data.people.filter((p) => p.group_id === g.id && !lead.some((l) => l.id === p.id) && match(p) && visible(p))
          .sort((a, b) => !isActive(a) - !isActive(b) || a.full_name.localeCompare(b.full_name));
        const leadsShown = lead.filter(match);
        if (q && !members.length && !leadsShown.length) return null;
        return html`<article class="band" style=${`--c:${g.color}`} key=${g.id}>
          <div class="band-stripe" aria-hidden="true"></div>
          <div class="band-head">
            <h2>${g.name}</h2>
            <span class="muted small">${g.team}</span>
          </div>
          <div class="band-leads">
            ${leadsShown.map((l) => html`<a class="lead-card" href=${"#/persona/" + l.id}>
              <${Avatar} person=${l} group=${g} size="lg" />
              <span><strong>${l.full_name}</strong><span class="muted small">${data.group_leads.find((x) => x.group_id === g.id && x.person_id === l.id)?.is_primary ? t("Lead") : t("Co-lead")}</span></span>
            </a>`)}
            ${!lead.length && html`<span class="muted small">${t("Reportan directo a Gus")}</span>`}
          </div>
          <div class="band-members">${members.map((p) => html`<${Chip} p=${p} g=${g} key=${p.id} />`)}</div>
        </article>`;
      })}
      ${(() => {
        const loose = data.people.filter((p) => !idx.group(p.group_id) && match(p) && visible(p));
        return loose.length ? html`<article class="band" style="--c:#94a3b8"><div class="band-stripe"></div><div class="band-head"><h2>${t("Sin grupo")}</h2></div><div class="band-members">${loose.map((p) => html`<${Chip} p=${p} key=${p.id} />`)}</div></article>` : null;
      })()}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------
// Pendientes: fila compacta y tabla con encabezados (Cambio 3)
// ---------------------------------------------------------------------
function useActionOps() {
  const { api, reload, isAdmin, session, me, idx } = useApp();
  const myPid = me?.person_id;
  // Cambio 11: Gus edita todo; quien lo creó o el líder de esa persona editan responsable, fecha, prioridad y estado;
  // el responsable solo cambia el estado.
  const canManage = (a) => isAdmin || (a.created_by && a.created_by === session.user.id)
    || (!!a.person_id && a.person_id !== myPid && !!idx.person(a.person_id) && !idx.isLead(a.person_id));
  const canStatus = (a) => canManage(a) || (!!myPid && a.owner_id === myPid);
  const set = async (a, patch) => { try { await api.update("actions", a.id, patch); await reload(); } catch (x) { toast(x.message, "bad"); } };
  return {
    canManage, canStatus, set,
    toggle: (a) => set(a, { status: a.status === "hecho" ? "pendiente" : "hecho" }),
  };
}

function ownerName(idx, a) {
  const o = a.owner_id ? idx.person(a.owner_id) : null;
  return o ? o.full_name : a.owner_id ? t("Otro líder") : "Gus";
}

function OwnerSelect({ a, onChange }) {
  const { data, idx, isAdmin, me } = useApp();
  const myPid = me?.person_id;
  const opts = data.people.filter((p) => isActive(p) && (isAdmin || p.id === myPid || (p.id !== myPid && !idx.isLead(p.id))))
    .sort((x, y) => (y.id === myPid) - (x.id === myPid) || x.full_name.localeCompare(y.full_name));
  const current = a.owner_id ?? "";
  const known = current === "" || opts.some((p) => p.id === current);
  return html`<select class="mini" value=${current} onChange=${(e) => onChange(e.target.value || null)} aria-label=${t("A cargo de")}>
    <option value="">Gus</option>
    ${!known && html`<option value=${current}>${ownerName(idx, a)}</option>`}
    ${opts.map((p) => html`<option value=${p.id}>${p.full_name}</option>`)}
  </select>`;
}

function ActionRow({ a }) {
  const { idx } = useApp();
  const ops = useActionOps();
  return html`<li class=${"action s-" + slug(a.status ?? "pendiente")}>
    <input type="checkbox" checked=${a.status === "hecho"} disabled=${!ops.canStatus(a)} onChange=${() => ops.toggle(a)} aria-label=${t("Marcar como hecho")} />
    <div class="action-body">
      <span>${a.body}</span>
      <span class="action-meta small">
        <${PriorityPill} a=${a} />
        <span class="muted">${t("A cargo de")}: ${firstName(ownerName(idx, a))}</span>
        <${Due} date=${a.due_date} status=${a.status} />
        ${a.private && html`<span class="cat">${t("privada")}</span>`}
      </span>
    </div>
  </li>`;
}

function ActionTable({ actions, empty }) {
  const { idx } = useApp();
  const ops = useActionOps();
  if (!actions.length) return html`<${Empty}>${empty ?? t("Sin pendientes.")}<//>`;
  return html`<div class="atable" role="table">
    <div class="at-row at-head" role="row">
      <span role="columnheader">${t("Tarea")}</span><span role="columnheader">${t("Sobre quién")}</span>
      <span role="columnheader">${t("A cargo de")}</span><span role="columnheader">${t("Fecha límite")}</span>
      <span role="columnheader">${t("Prioridad")}</span><span role="columnheader">${t("Estado")}</span>
    </div>
    ${actions.map((a) => {
      const full = ops.canManage(a);
      const st = ops.canStatus(a);
      return html`<div class=${"at-row s-" + slug(a.status ?? "pendiente") + (full ? "" : " ro")} role="row" key=${a.id}>
      <span class="at-task" role="cell">
        <input type="checkbox" checked=${a.status === "hecho"} disabled=${!st} onChange=${() => ops.toggle(a)} aria-label=${t("Marcar como hecho")} />
        <span>${a.body}${a.private && html` <span class="cat">${t("privada")}</span>`}</span>
      </span>
      <span role="cell" data-label=${t("Sobre quién")}>${a.person_id ? html`<${PersonLink} id=${a.person_id} />` : html`<span class="muted">${t("General")}</span>`}</span>
      <span role="cell" data-label=${t("A cargo de")}>${full ? html`<${OwnerSelect} a=${a} onChange=${(v) => ops.set(a, { owner_id: v })} />` : ownerName(idx, a)}</span>
      <span role="cell" data-label=${t("Fecha límite")}>${full
        ? html`<input type="date" class=${"mini date-in" + (isOverdue(a) ? " late" : "")} value=${a.due_date ?? ""} onChange=${(e) => ops.set(a, { due_date: e.target.value || null })} aria-label=${t("Fecha límite")} />`
        : html`<${Due} date=${a.due_date} status=${a.status} />`}</span>
      <span role="cell" data-label=${t("Prioridad")}>${full
        ? html`<select class=${"mini prio-sel pr-" + light(a)} value=${a.priority ?? "media"} onChange=${(e) => ops.set(a, { priority: e.target.value })} aria-label=${t("Prioridad")}>
            ${PRIORITIES.map((p) => html`<option value=${p}>${t(p)}</option>`)}
          </select>`
        : html`<${PriorityPill} a=${a} />`}</span>
      <span role="cell" data-label=${t("Estado")}>${st
        ? html`<select class="mini" value=${a.status} onChange=${(e) => ops.set(a, { status: e.target.value })} aria-label=${t("Estado")}>
            ${STATUSES.map((x) => html`<option value=${x}>${t(x)}</option>`)}
          </select>`
        : html`<span class="small">${t(a.status)}</span>`}</span>
    </div>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------------
// Perfil: antes / ahora / siguiente
// ---------------------------------------------------------------------
function SuggestionCard({ s, compact }) {
  const { api, reload, isAdmin, data } = useApp();
  const [open, setOpen] = useState(!compact);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const updates = data.suggestion_updates.filter((u) => u.suggestion_id === s.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const set = async (patch, log) => {
    setBusy(true);
    try {
      if (Object.keys(patch).length) await api.update("suggestions", s.id, patch);
      if (log) await api.insert("suggestion_updates", [{ suggestion_id: s.id, ...log }]);
      setComment("");
      reload();
    } catch (x) { toast(x.message, "bad"); }
    setBusy(false);
  };
  const src = s.source === "lead" ? ` · ${t("propuesta del lead")}` : s.source === "gus" ? ` · ${t("de Gus")}` : "";
  return html`<article class=${"sugg st-" + slug(s.status)}>
    <header onClick=${() => setOpen(!open)}>
      <div>
        <h4>${s.title}</h4>
        <span class="small muted">${s.category ? t(s.category) : ""}${src}</span>
      </div>
      <span class=${"pill p-" + slug(s.status)}>${t(s.outcome ? s.outcome : s.status)}</span>
    </header>
    ${open && html`<div class="sugg-body">
      ${s.why && html`<p><strong>${t("Por qué.")}</strong> ${s.why}</p>`}
      ${s.how && html`<div class="how">${s.how.split("\n").filter(Boolean).map((l) => html`<p>${l}</p>`)}</div>`}
      ${s.resources && html`<p class="small muted">${s.resources}</p>`}
      ${updates.length > 0 && html`<ul class="updates">${updates.map((u) => html`<li><span class="small muted">${fmtDate(u.created_at)}</span> ${u.outcome && html`<b>${t(u.outcome)}</b>`} ${u.comment}</li>`)}</ul>`}
      <div class="sugg-actions">
        ${isAdmin && s.status === "propuesta" && html`
          <button class="primary" disabled=${busy} onClick=${() => set({ status: "validada" })}>${t("Validar y compartir")}</button>
          <button disabled=${busy} onClick=${() => set({ status: "descartada" })}>${t("Descartar")}</button>`}
        ${s.status === "validada" && html`<button class="primary" disabled=${busy} onClick=${() => set({ status: "en uso" }, { status: "en uso", comment: t("Lo voy a usar") })}>${t("Lo voy a usar")}</button>`}
        ${s.status === "en uso" && html`
          <input class="grow" placeholder=${t("¿Cómo te fue? (opcional)")} value=${comment} onInput=${(e) => setComment(e.target.value)} />
          <span class="seg" role="group" aria-label=${t("Resultado")}>
            ${["funcionó", "parcial", "no funcionó"].map((o) => html`<button class=${s.outcome === o ? "on" : ""} disabled=${busy} onClick=${() => set({ outcome: o }, { outcome: o, comment })}>${t(o)}</button>`)}
          </span>`}
        ${s.status === "en uso" && comment && html`<button disabled=${busy} onClick=${() => set({}, { comment })}>${t("Guardar comentario")}</button>`}
        ${isAdmin && s.status !== "propuesta" && html`<button class="link" onClick=${() => set({ status: "descartada" })}>${t("Archivar")}</button>`}
      </div>
    </div>`}
  </article>`;
}

function AddNote({ person, onClose }) {
  const { api, reload, isAdmin } = useApp();
  const [kind, setKind] = useState(isAdmin ? "observación" : "avance");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [priv, setPriv] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await api.insert("insights", [{ person_id: person.id, kind, category: category || null, body: body.trim(), private: isAdmin && priv }]);
      toast(t("Nota guardada")); reload(); onClose();
    } catch (x) { toast(x.message, "bad"); }
  };
  return html`<${Modal} title=${t("Nota sobre {n}", { n: firstName(person.full_name) })} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <div class="row">
        <label class="grow">${t("Tipo")}<select value=${kind} onChange=${(e) => setKind(e.target.value)}>${KIND_ORDER.map((k) => html`<option value=${k}>${t(KIND_LABEL[k])}</option>`)}</select></label>
        <label class="grow">${t("Tema")}<input list="cats" value=${category} onInput=${(e) => setCategory(e.target.value)} placeholder=${t("comunicación, calidad…")} /></label>
      </div>
      <label>${t("Qué pasó")}<textarea rows="4" value=${body} onInput=${(e) => setBody(e.target.value)} placeholder=${t("Ej.: aplicó el checklist toda la semana y bajaron sus errores.")}></textarea></label>
      ${isAdmin && html`<label class="check"><input type="checkbox" checked=${priv} onChange=${(e) => setPriv(e.target.checked)} /> ${t("Solo para mí (el lead no la ve)")}</label>`}
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary">${t("Guardar nota")}</button></div>
    </form>
  <//>`;
}

function EditPerson({ person, onClose, defaultGroup }) {
  const { api, reload, data } = useApp();
  const [f, setF] = useState({ status: "activo", group_id: defaultGroup ?? null, ...person });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const patch = { full_name: f.full_name, nickname: f.nickname || null, title: f.title || null, focus: f.focus || null, notes: f.notes || null, email: f.email || null, group_id: f.group_id || null, status: f.status, is_lead: !!f.is_lead };
    try {
      if (person.id) await api.update("people", person.id, patch);
      else await api.insert("people", [patch]);
      toast(t("Guardado")); reload(); onClose();
    } catch (x) { toast(x.message, "bad"); }
  };
  return html`<${Modal} title=${person.id ? t("Editar persona") : t("Agregar persona")} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <div class="row"><label class="grow">${t("Nombre completo")}<input required value=${f.full_name ?? ""} onInput=${set("full_name")} /></label><label>${t("Apodo")}<input value=${f.nickname ?? ""} onInput=${set("nickname")} /></label></div>
      <div class="row"><label class="grow">${t("Rol")}<input value=${f.title ?? ""} onInput=${set("title")} /></label>
        <label class="grow">${t("Grupo")}<select value=${f.group_id ?? ""} onChange=${set("group_id")}><option value="">${t("Sin grupo")}</option>${data.groups.map((g) => html`<option value=${g.id}>${g.name}</option>`)}</select></label></div>
      <label>${t("En qué trabaja")}<input value=${f.focus ?? ""} onInput=${set("focus")} placeholder="Site Services → Landing Pages → Postings" /></label>
      <label>${t("Correo (para su usuario)")}<input type="email" value=${f.email ?? ""} onInput=${set("email")} /></label>
      <label>${t("Notas")}<textarea rows="3" value=${f.notes ?? ""} onInput=${set("notes")}></textarea></label>
      <div class="row">
        <label class="grow">${t("Estado")}<select value=${f.status} onChange=${set("status")}>${["activo", "pausado", "inactivo", "salió"].map((s) => html`<option value=${s}>${t(s)}</option>`)}</select></label>
        <label class="check grow"><input type="checkbox" checked=${!!f.is_lead} onChange=${set("is_lead")} /> ${t("Es lead")}</label>
      </div>
      <p class="small muted">${t("Si pasa a inactivo o salió, deja de aparecer para su lead. Su historial se conserva.")}</p>
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary">${t("Guardar")}</button></div>
    </form>
  <//>`;
}

// Cambio 8: agregar una persona al grupo de un lead
function AddToGroup({ lead, onClose }) {
  const { api, reload, idx } = useApp();
  const groups = idx.groupsLedBy(lead.id);
  const [gid, setGid] = useState(groups[0]?.id ?? "");
  const [mode, setMode] = useState("existing");
  const [pid, setPid] = useState(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!gid) return;
    setBusy(true);
    try {
      if (mode === "existing") {
        if (!pid) { setBusy(false); return toast(t("Elige a una persona."), "bad"); }
        await api.update("people", pid, { group_id: gid, status: "activo" });
      } else {
        if (!name.trim()) { setBusy(false); return toast(t("Escribe el nombre."), "bad"); }
        await api.insert("people", [{ full_name: name.trim(), title: title || null, group_id: gid, status: "activo" }]);
      }
      toast(t("Agregado al grupo")); await reload(); onClose();
    } catch (x) { toast(x.message, "bad"); setBusy(false); }
  };
  return html`<${Modal} title=${t("Agregar persona al grupo de {n}", { n: firstName(lead.full_name) })} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      ${groups.length > 1 && html`<label>${t("Grupo")}<select value=${gid} onChange=${(e) => setGid(e.target.value)}>${groups.map((g) => html`<option value=${g.id}>${g.name}</option>`)}</select></label>`}
      <span class="seg" role="group">
        <button type="button" class=${mode === "existing" ? "on" : ""} onClick=${() => setMode("existing")}>${t("Persona existente")}</button>
        <button type="button" class=${mode === "new" ? "on" : ""} onClick=${() => setMode("new")}>${t("Persona nueva")}</button>
      </span>
      ${mode === "existing"
        ? html`<label>${t("Persona")}<${PersonSelect} value=${pid} onChange=${setPid} only=${(p) => p.group_id !== gid && p.id !== lead.id} allowEmpty=${t("Elige una persona")} includeInactive /></label>
               <p class="small muted">${t("Se mueve a este grupo y sale del anterior.")}</p>`
        : html`<label>${t("Nombre completo")}<input required value=${name} onInput=${(e) => setName(e.target.value)} /></label>
               <label>${t("Rol")}<input value=${title} onInput=${(e) => setTitle(e.target.value)} /></label>`}
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary" disabled=${busy}>${t("Agregar")}</button></div>
    </form>
  <//>`;
}

function PrepPanel({ person, onClose }) {
  const { api } = useApp();
  const [prep, setPrep] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.fn("prep", { person_id: person.id, lang: LANG }).then((r) => setPrep(r.prep)).catch((x) => setErr(x.message));
  }, []);
  const List = ({ title, items }) => items?.length ? html`<section><h3>${title}</h3><ul>${items.map((i) => html`<li>${i}</li>`)}</ul></section>` : null;
  return html`<${Modal} title=${t("Próxima reunión con {n}", { n: firstName(person.full_name) })} onClose=${onClose} wide>
    ${err ? html`<p class="error">${err}</p>` : !prep ? html`<${Busy} label=${t("La IA está revisando el historial…")} />` : html`<div class="prep">
      <p class="lede">${prep.headline}</p>
      <div class="prep-grid">
        <${List} title=${t("Lo que quedó la última vez")} items=${prep.last_time} />
        <${List} title=${t("Pendientes a revisar")} items=${prep.open_items} />
        <${List} title=${t("Lo que funcionó")} items=${prep.what_worked} />
        <${List} title=${t("Lo que no funcionó")} items=${prep.what_didnt} />
      </div>
      ${prep.suggested_points?.length > 0 && html`<section><h3>${t("Puntos sugeridos")}</h3>${prep.suggested_points.map((s) => html`<div class="point"><strong>${s.topic}</strong><p class="muted">${s.why}</p><p class="quote">“${s.how_to_open}”</p></div>`)}</section>`}
      <${List} title=${t("Preguntas clave")} items=${prep.questions} />
      ${prep.people?.length > 0 && html`<section><h3>${t("Su gente")}</h3><table class="tbl"><tbody>${prep.people.map((p) => html`<tr><td><strong>${p.name}</strong></td><td>${p.status}</td><td class="muted">${p.focus}</td></tr>`)}</tbody></table></section>`}
    </div>`}
  <//>`;
}

function IdeasModal({ person, onClose }) {
  const { api, reload } = useApp();
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api.fn("ideas", { person_id: person.id, focus, lang: LANG }); toast(t("{n} ideas nuevas para validar", { n: r.created })); reload(); onClose(); }
    catch (x) { toast(x.message, "bad"); setBusy(false); }
  };
  return html`<${Modal} title=${t("Nuevas ideas para {n}", { n: firstName(person.full_name) })} onClose=${onClose}>
    <form class="stack" onSubmit=${run}>
      <p class="muted">${t("La IA revisa su historial y lo que ya funcionó o no, y propone 3 métodos. Quedan como propuestas hasta que las valides.")}</p>
      <label>${t("¿En qué quieres enfocarte? (opcional)")}<input value=${focus} onInput=${(e) => setFocus(e.target.value)} placeholder=${t("Ej.: que pregunte con toda la info")} /></label>
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary" disabled=${busy}>${busy ? t("Pensando…") : t("Proponer ideas")}</button></div>
    </form>
  <//>`;
}

function PersonView({ id }) {
  const { data, idx, isAdmin, me } = useApp();
  const [modal, setModal] = useState(null);
  const p = idx.person(id);
  if (!p) return html`<section class="page"><${Empty}>${t("No encontré a esta persona o no tienes acceso.")}<//></section>`;
  const g = idx.group(p.group_id);
  const s = personStats(data, p.id);
  const isMe = me?.person_id === p.id;
  const insights = data.insights.filter((i) => i.person_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const actions = data.actions.filter((a) => a.person_id === p.id);
  const open = actions.filter((a) => OPEN.includes(a.status)).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const done = actions.filter((a) => a.status === "hecho").sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "")).slice(0, 5);
  const sugg = data.suggestions.filter((x) => x.person_id === p.id);
  const inUse = sugg.filter((x) => x.status === "en uso");
  const next = sugg.filter((x) => x.status === "propuesta" || x.status === "validada");
  const meetings = data.meetings.filter((m) => m.person_id === p.id).sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));
  const lastWithTopics = meetings.find((m) => m.analysis?.next_meeting_topics?.length);
  const ledGroups = idx.groupsLedBy(p.id);
  const myGroup = ledGroups.length ? data.people.filter((x) => ledGroups.some((gg) => gg.id === x.group_id) && x.id !== p.id && isActive(x)) : [];
  const ownedByLead = ledGroups.length ? data.actions.filter((a) => a.owner_id === p.id && OPEN.includes(a.status) && a.person_id !== p.id) : [];
  const trend = s.up > s.down ? t("Subiendo") : s.down > s.up ? t("Con temas a trabajar") : s.notes ? t("Estable") : t("Sin notas recientes");

  const byMeeting = [];
  for (const i of insights) {
    const key = i.meeting_id ?? "n-" + i.created_at.slice(0, 10);
    let b = byMeeting.find((x) => x.key === key);
    if (!b) byMeeting.push((b = { key, meeting: idx.meeting(i.meeting_id), date: i.created_at, items: [] }));
    b.items.push(i);
  }
  for (const m of meetings) {
    if (!m.summary) continue;
    let b = byMeeting.find((x) => x.key === m.id);
    if (!b) byMeeting.push((b = { key: m.id, meeting: m, date: m.meeting_date, items: [] }));
    b.summary = m.summary;
  }
  byMeeting.sort((a, b) => String(b.meeting?.meeting_date ?? b.date).localeCompare(String(a.meeting?.meeting_date ?? a.date)));

  return html`<section class="page person" style=${`--c:${g?.color ?? "#64748b"}`}>
    <header class="person-head">
      <${Avatar} person=${p} group=${g} size="xl" />
      <div class="grow">
        <h1>${p.full_name}${p.nickname ? html` <span class="nick">${p.nickname}</span>` : ""}</h1>
        <p class="muted">${[p.title, g?.name].filter(Boolean).join(", ")}${p.status !== "activo" ? ` (${t(p.status)})` : ""}</p>
        ${p.focus && html`<p class="small">${p.focus}</p>`}
        ${p.notes && isAdmin && html`<p class="small muted">${p.notes}</p>`}
      </div>
      <div class="head-actions">
        <button class="primary" onClick=${() => setModal("prep")}>${t("Preparar reunión")}</button>
        ${(isAdmin || (!isMe && !idx.isLead(p.id))) && html`<button onClick=${() => setModal("note")}>${t("Agregar nota")}</button>`}
        ${isAdmin && html`<button onClick=${() => setModal("ideas")}>${t("Ideas con IA")}</button>`}
        ${isAdmin && html`<button class="icon" title=${t("Editar")} aria-label=${t("Editar persona")} onClick=${() => setModal("edit")}>✎</button>`}
      </div>
    </header>

    <div class="trend">
      <span class=${"trend-dot " + (s.up > s.down ? "up" : s.down > s.up ? "down" : "flat")}></span>
      <span><strong>${trend}</strong> <span class="muted small">${t("en los últimos 60 días: {u} avances o fortalezas, {d} temas a mejorar", { u: s.up, d: s.down })}</span></span>
    </div>

    <${BambooPersonBlock} person=${p} />

    ${(ledGroups.length > 0) && html`<section class="block">
      <div class="row between"><h2>${t("Su gente")}</h2>${isAdmin && html`<button onClick=${() => setModal("add")}>${t("Agregar persona")}</button>`}</div>
      ${myGroup.length ? html`<div class="band-members">${myGroup.map((x) => html`<${Chip} p=${x} g=${idx.group(x.group_id)} key=${x.id} />`)}</div>` : html`<${Empty}>${t("Todavía no tiene personas a cargo.")}<//>`}
      ${ownedByLead.length > 0 && html`<h3 class="mt">${t("Lo que tiene a cargo")}</h3><${ActionTable} actions=${ownedByLead} />`}
    </section>`}

    <div class="tri">
      <section class="col">
        <h2>${t("Antes")}</h2>
        ${meetings.length > 0 && html`<div class="mlist">${meetings.slice(0, 4).map((m) => html`<a class="mchip" href=${"#/reunion/" + m.id}>${t(MEETING_KIND[m.kind])} ${fmtDate(m.meeting_date)}</a>`)}</div>`}
        ${byMeeting.length === 0 && html`<${Empty}>${t("Todavía no hay notas. Pega una transcripción en Nueva reunión o agrega una nota.")}<//>`}
        <ol class="timeline">
          ${byMeeting.map((b) => html`<li key=${b.key}>
            <div class="tl-date">${b.meeting ? html`<a href=${"#/reunion/" + b.meeting.id}>${t(MEETING_KIND[b.meeting.kind])} ${fmtDate(b.meeting.meeting_date)}</a>` : fmtDate(b.date)}</div>
            ${b.summary && html`<p class="tl-sum">${b.summary}</p>`}
            ${b.items.map((i) => html`<div class="tl-item"><${Kind} kind=${i.kind} />${i.category && html`<span class="cat">${t(i.category)}</span>`}${i.private && html`<span class="cat">${t("privada")}</span>`}<p>${i.body}</p></div>`)}
          </li>`)}
        </ol>
      </section>

      <section class="col">
        <h2>${t("Ahora")}</h2>
        <h3>${t("Pendientes")}</h3>
        ${open.length ? html`<ul class="actions">${open.map((a) => html`<${ActionRow} a=${a} key=${a.id} />`)}</ul>` : html`<${Empty}>${t("Sin pendientes abiertos.")}<//>`}
        <h3 class="mt">${t("Métodos en uso")}</h3>
        ${inUse.length ? inUse.map((x) => html`<${SuggestionCard} s=${x} key=${x.id} />`) : html`<${Empty}>${t("Ningún método en uso todavía.")}<//>`}
        ${done.length > 0 && html`<details class="mt"><summary>${t("Hechos recientes ({n})", { n: done.length })}</summary><ul class="actions">${done.map((a) => html`<${ActionRow} a=${a} key=${a.id} />`)}</ul></details>`}
      </section>

      <section class="col">
        <h2>${t("Siguiente")}</h2>
        ${lastWithTopics && html`<h3>${t("Para retomar")}</h3><ul class="plain">${lastWithTopics.analysis.next_meeting_topics.map((x) => html`<li>${x}</li>`)}</ul>`}
        <h3 class=${lastWithTopics ? "mt" : ""}>${t("Plan de mejora")}</h3>
        ${next.length ? next.map((x) => html`<${SuggestionCard} s=${x} compact key=${x.id} />`) : html`<${Empty}>${isAdmin ? t("Pide ideas con IA o analiza una reunión para armar su plan.") : t("Todavía no hay métodos compartidos para esta persona.")}<//>`}
        ${sugg.filter((x) => x.outcome).length > 0 && html`<details class="mt"><summary>${t("Resultados anteriores")}</summary>${sugg.filter((x) => x.outcome && x.status !== "en uso").map((x) => html`<${SuggestionCard} s=${x} compact key=${x.id} />`)}</details>`}
      </section>
    </div>

    ${modal === "note" && html`<${AddNote} person=${p} onClose=${() => setModal(null)} />`}
    ${modal === "prep" && html`<${PrepPanel} person=${p} onClose=${() => setModal(null)} />`}
    ${modal === "ideas" && html`<${IdeasModal} person=${p} onClose=${() => setModal(null)} />`}
    ${modal === "edit" && html`<${EditPerson} person=${p} onClose=${() => setModal(null)} />`}
    ${modal === "add" && html`<${AddToGroup} lead=${p} onClose=${() => setModal(null)} />`}
  </section>`;
}

// ---------------------------------------------------------------------
// Reuniones
// ---------------------------------------------------------------------
const STATUS_M = { borrador: "Sin analizar", analizado: "Por revisar", aplicado: "Aplicada" };

// Cambio 12: recomendación de liderazgo, grande y fácil de leer, con "Me sirve / No me sirve"
function CoachCard({ c, onDecide, busy }) {
  const d = c.decision;
  return html`<article class=${"coach" + (d === "no me sirve" ? " off" : d === "me sirve" ? " yes" : "")}>
    <header>
      <span class="for">${t("Para")}: ${c.for_person}</span>
      ${d && html`<span class=${"pill " + (d === "me sirve" ? "p-aplicado" : "")}>${t(d)}</span>`}
    </header>
    <h3>${c.title}</h3>
    ${c.why && html`<p class="why">${c.why}</p>`}
    ${c.steps?.length > 0 && html`<ol class="steps">${c.steps.map((x) => html`<li>${x}</li>`)}</ol>`}
    ${c.first_step && html`<p class="first"><strong>${t("Esta semana")}:</strong> ${c.first_step}</p>`}
    ${c.say_it && html`<p class="quote">“${c.say_it}”</p>`}
    ${c.measure && html`<p class="small muted"><strong>${t("Cómo saber si funcionó")}:</strong> ${c.measure}</p>`}
    ${onDecide && html`<div class="seg decide" role="group" aria-label=${t("¿Te sirve?")}>
      <button class=${d === "me sirve" ? "on" : ""} disabled=${busy} onClick=${() => onDecide(d === "me sirve" ? null : "me sirve")}>${t("Me sirve")}</button>
      <button class=${d === "no me sirve" ? "on" : ""} disabled=${busy} onClick=${() => onDecide(d === "no me sirve" ? null : "no me sirve")}>${t("No me sirve")}</button>
    </div>`}
  </article>`;
}

function MeetingsView() {
  const { data, idx, isAdmin } = useApp();
  const ms = [...data.meetings].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date) || b.created_at.localeCompare(a.created_at));
  return html`<section class="page">
    <header class="page-head"><div><h1>${t("Reuniones")}</h1><p class="muted">${isAdmin ? t("Tus 1:1 y mensuales, con lo que salió de cada una.") : t("Tus reuniones con Gus y las que subiste tú.")}</p></div>
      <a class="btn primary" href="#/nueva">${t("Nueva reunión")}</a></header>
    ${ms.length === 0 && html`<${Empty}>${t("Aún no hay reuniones.")}<//>`}
    <ul class="meetings">
      ${ms.map((m) => {
        const p = idx.person(m.person_id);
        const g = idx.group(p?.group_id);
        return html`<li key=${m.id}><a href=${"#/reunion/" + m.id} class="meeting-row" style=${`--c:${g?.color ?? "#94a3b8"}`}>
          <span class="m-date"><strong>${fmtDate(m.meeting_date)}</strong><span class="small muted">${t(MEETING_KIND[m.kind])}</span></span>
          <span class="grow"><strong>${m.title || (p ? t("Con {n}", { n: p.full_name }) : t("Reunión"))}</strong><span class="small muted clamp">${m.summary ?? ""}</span></span>
          <span class=${"pill p-" + m.status}>${t(STATUS_M[m.status])}</span>
        </a></li>`;
      })}
    </ul>
  </section>`;
}

function MeetingView({ id }) {
  const { data, idx, isAdmin, api, reload, session } = useApp();
  const [showT, setShowT] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cBusy, setCBusy] = useState(false);
  const m = idx.meeting(id);
  if (!m) return html`<section class="page"><${Empty}>${t("Reunión no encontrada.")}<//></section>`;
  const mine = isAdmin || m.created_by === session.user.id;
  const p = idx.person(m.person_id);
  const ins = data.insights.filter((i) => i.meeting_id === m.id);
  const acts = data.actions.filter((a) => a.meeting_id === m.id);
  const sugg = data.suggestions.filter((s) => s.meeting_id === m.id);
  const an = m.analysis;
  const showPanel = mine && !m.shared;
  const people = [...new Set([...ins.map((i) => i.person_id), ...(showPanel ? [] : sugg.map((s) => s.person_id))])];
  const coaching = an?.coaching ?? [];
  const decide = async (i, decision) => {
    setCBusy(true);
    try { await api.update("meetings", m.id, { analysis: { ...an, coaching: coaching.map((c, j) => (j === i ? { ...c, decision } : c)) } }); await reload(); }
    catch (x) { toast(x.message, "bad"); }
    setCBusy(false);
  };
  const genRecs = async () => {
    setCBusy(true);
    try { await api.fn("recommend", { meeting_id: m.id }); await reload(); } catch (x) { toast(x.message, "bad"); }
    setCBusy(false);
  };
  const reanalyze = async () => {
    setBusy(true);
    try { await api.fn("analyze", { meeting_id: m.id }); await reload(); go("#/revisar/" + m.id); }
    catch (x) { toast(x.message, "bad"); }
    setBusy(false);
  };
  const pendingReview = !isAdmin && data.reviews.some((r) => r.meeting_id === m.id && r.status === "pendiente");
  const del = async () => {
    if (pendingReview) return toast(t("Tiene puntos pendientes para Gus. Podrás borrarla cuando él los revise."), "bad");
    if (!confirm(t("¿Borrar esta reunión? Las notas y pendientes que generó se mantienen."))) return;
    try { await api.remove("meetings", m.id); await reload(); go("#/reuniones"); } catch (x) { toast(x.message, "bad"); }
  };
  return html`<section class=${"page" + (showPanel ? " with-panel" : "")}>
    <a href="#/reuniones" class="back">${t("Reuniones")}</a>
    <div class=${showPanel ? "split" : ""}><div class="split-main">
    <header class="page-head"><div>
      <h1>${m.title || t("{k} con {n}", { k: t(MEETING_KIND[m.kind]), n: p?.full_name ?? "—" })}</h1>
      <p class="muted">${fmtDate(m.meeting_date)}${p ? html`, ${t("con")} <${PersonLink} id=${p.id} />` : ""}</p>
    </div>
    ${mine && html`<div class="head-actions">
      ${m.status === "analizado" && html`<a class="btn primary" href=${"#/revisar/" + m.id}>${t("Revisar y aplicar")}</a>`}
      ${m.transcript && m.status !== "aplicado" && html`<button disabled=${busy} onClick=${async () => { setBusy(true); try { await organizeMeeting(api, data, idx, m); await reload(); go("#/revisar/" + m.id); } catch (x) { toast(x.message, "bad"); setBusy(false); } }}>${t("Ordenar sin IA")}</button>`}
      ${m.transcript && html`<button disabled=${busy} onClick=${reanalyze}>${busy ? t("Analizando…") : m.status === "borrador" ? t("Analizar con IA") : t("Volver a analizar")}</button>`}
      <button class="link" onClick=${del}>${t("Borrar")}</button>
    </div>`}</header>

    ${m.summary && html`<p class="lede">${m.summary}</p>`}
    ${an && html`<div class="prep-grid">
      ${an.topics?.length > 0 && html`<section><h3>${t("Temas")}</h3><ul>${an.topics.map((x) => html`<li>${x}</li>`)}</ul></section>`}
      ${an.next_meeting_topics?.length > 0 && html`<section><h3>${t("Para la próxima")}</h3><ul>${an.next_meeting_topics.map((x) => html`<li>${x}</li>`)}</ul></section>`}
      ${an.risks?.length > 0 && html`<section class="risk"><h3>${t("Alertas")}</h3><ul>${an.risks.map((x) => html`<li>${x}</li>`)}</ul></section>`}
    </div>`}

    ${acts.length > 0 && html`<section class="block"><h2>${t("Siguientes pasos")}</h2><${ActionTable} actions=${acts} /></section>`}

    ${people.length > 0 && html`<section class="block"><h2>${t("Por persona")}</h2>
      <div class="per-person">${people.map((pid) => html`<div class="pp" key=${pid}>
        <h3><${PersonLink} id=${pid} /></h3>
        ${ins.filter((i) => i.person_id === pid).map((i) => html`<div class="tl-item"><${Kind} kind=${i.kind} />${i.private && html`<span class="cat">${t("privada")}</span>`}<p>${i.body}</p></div>`)}
        ${!showPanel && sugg.filter((s) => s.person_id === pid).map((s) => html`<${SuggestionCard} s=${s} compact key=${s.id} />`)}
      </div>`)}</div>
    </section>`}

    ${mine && m.transcript && html`<section class="block"><button class="link" onClick=${() => setShowT(!showT)}>${showT ? t("Ocultar transcripción") : t("Ver transcripción")}</button>
      ${showT && html`<pre class="transcript">${m.transcript}</pre>`}</section>`}
    </div>
    ${showPanel && html`<aside class="coach-panel" aria-label=${t("Recomendaciones de liderazgo")}>
      <h2>${t("Recomendaciones de liderazgo")}</h2>
      <p class="small muted">${t("Para quien dirige la reunión: cómo acompañar a cada persona. Marca las que te sirven.")}</p>
      ${cBusy && !coaching.length ? html`<${Busy} label=${t("La IA está preparando recomendaciones…")} />`
        : coaching.length ? coaching.map((c, i) => html`<${CoachCard} c=${c} busy=${cBusy} onDecide=${(d) => decide(i, d)} key=${i} />`)
        : html`<div class="coach-empty">
            <p class="small">${an?.source === "manual" ? t("Esta reunión se ordenó sin IA, así que no tiene recomendaciones.") : t("Esta reunión todavía no tiene recomendaciones de liderazgo.")}</p>
            ${(m.transcript || m.summary) && m.status !== "borrador"
              ? html`<button class="primary" disabled=${cBusy} onClick=${genRecs}>${t("Generar recomendaciones con IA")}</button>`
              : html`<p class="small muted">${t("Primero analiza u ordena la reunión.")}</p>`}
          </div>`}
      ${sugg.length > 0 && html`<h2 class="mt">${t("Métodos por persona")}</h2>
        ${sugg.map((x) => html`<div class="sugg-who" key=${x.id}><span class="small muted">${t("Para")} <${PersonLink} id=${x.person_id} /></span><${SuggestionCard} s=${x} /></div>`)}`}
    </aside>`}
    </div>
  </section>`;
}

function NewMeeting() {
  const { api, reload, isAdmin, me, data, idx } = useApp();
  const [f, setF] = useState({ person_id: isAdmin ? "" : me?.person_id ?? "", kind: "1-1", meeting_date: today(), title: "", transcript: "", shared_with_lead: true });
  const [busy, setBusy] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const withLead = idx.isLead(f.person_id);
  const useTemplate = () => {
    if (f.transcript.trim() && !confirm(t("¿Reemplazar lo que escribiste por la plantilla?"))) return;
    setF({ ...f, transcript: withLead ? TEMPLATE_GROUP : TEMPLATE_ONE });
  };
  const save = async (mode) => {
    if (!f.person_id) return toast(t("Elige con quién fue la reunión."), "bad");
    if (!f.transcript.trim()) return toast(t("Pega la transcripción o tus notas."), "bad");
    setBusy(mode === "ai" ? t("La IA está leyendo la reunión… (puede tardar 1 minuto)") : t("Ordenando…"));
    try {
      const [m] = await api.insert("meetings", [{ ...f, title: f.title || null, status: "borrador" }]);
      if (mode === "ai") await api.fn("analyze", { meeting_id: m.id });
      else await organizeMeeting(api, data, idx, m);
      await reload(); go("#/revisar/" + m.id);
    } catch (x) { toast(x.message, "bad"); setBusy(""); }
  };
  const nwords = f.transcript.trim() ? f.transcript.trim().split(/\s+/).length : 0;
  return html`<section class="page narrow">
    <header class="page-head"><div><h1>${t("Nueva reunión")}</h1>
      <p class="muted">${t("Pega la transcripción de Google Meet o tus notas. Usa la IA para los casos que necesitan análisis; para la gente que va bien, ordena tus notas sin IA (no cuesta nada).")}</p>
      ${!isAdmin && html`<p class="muted small">${t("Lo de tu gente lo validas tú. Lo que sea sobre ti o sobre otros líderes le llega a Gus para que lo revise.")}</p>`}
    </div></header>
    ${busy ? html`<${Busy} label=${busy} />` : html`<div class="stack">
      <div class="row">
        <label class="grow">${t("Con quién")}<${PersonSelect} value=${f.person_id} onChange=${(v) => setF({ ...f, person_id: v })} allowEmpty=${t("Elige una persona")} /></label>
        <label>${t("Tipo")}<select value=${f.kind} onChange=${set("kind")}>${Object.entries(MEETING_KIND).map(([k, v]) => html`<option value=${k}>${t(v)}</option>`)}</select></label>
        <label>${t("Fecha")}<input type="date" value=${f.meeting_date} onInput=${set("meeting_date")} /></label>
      </div>
      <label>${t("Título (opcional)")}<input value=${f.title} onInput=${set("title")} placeholder=${t("Ej.: Mensual de octubre")} /></label>
      <label>
        <span class="row between"><span>${t("Transcripción o notas")} <span class="muted small">${nwords ? t("{n} palabras", { n: nwords }) : ""}</span></span>
          <button type="button" class="link small" onClick=${useTemplate}>${t("Usar plantilla")}</button></span>
        <textarea class="big" value=${f.transcript} onInput=${set("transcript")} placeholder=${t("Pega aquí todo el texto. Puede estar en español o inglés.")}></textarea></label>
      <details class="fmt"><summary>${t("Cómo escribir notas para ordenar sin IA")}</summary>
        <ul>
          <li>${t("Una sección Updates y otra Pendientes.")}</li>
          <li>${t("En Updates: Nombre: lo que pasó. En un 1:1 puedes omitir el nombre.")}</li>
          <li>${t("En Pendientes: Nombre: la tarea, con fecha 28/10 y (alta) o (baja) si quieres.")}</li>
          <li>${t("Opcional: (+) al inicio para algo positivo y (-) para algo a mejorar.")}</li>
        </ul>
        <pre class="fmt-ex">${withLead ? TEMPLATE_GROUP : TEMPLATE_ONE}</pre>
      </details>
      ${isAdmin && html`<label class="check"><input type="checkbox" checked=${f.shared_with_lead} onChange=${set("shared_with_lead")} /> ${t("Compartir esta reunión con la persona (si tiene usuario)")}</label>`}
      <div class="row end">
        <button onClick=${() => save("manual")} title=${t("Reparte tus notas en los perfiles, sin IA y sin costo")}>${t("Ordenar sin IA")}</button>
        <button class="primary" onClick=${() => save("ai")}>${t("Analizar con IA")}</button>
      </div>
    </div>`}
  </section>`;
}

// ---------------------------------------------------------------------
// Revisión del análisis (admin y lead) — Cambios 1, 2, 3 y 5
// ---------------------------------------------------------------------
function Review({ id }) {
  const { data, idx, api, reload, isAdmin, me } = useApp();
  const m = idx.meeting(id);
  const an = m?.analysis;
  const lead = idx.person(m?.person_id);
  const myPid = me?.person_id;
  // ¿Quién es "el lead" responsable en esta reunión?
  const meetingLead = idx.isLead(m?.person_id) ? m.person_id : idx.leadOf(m?.person_id);
  const leadFor = (pid) => (isAdmin ? (pid ? idx.leadOf(pid) ?? meetingLead : meetingLead) : myPid);
  // Cambio 1: lo que es sobre otro líder sale privado
  const defaultPrivate = (pid) => isAdmin && idx.isLead(pid) && pid !== m?.person_id;
  // Cambio 2: para un lead, lo que es sobre él, sobre otros líderes o sobre gente que no ve va a Gus
  const canHandle = (pid) => isAdmin || (!!pid && pid !== myPid && !!idx.person(pid) && !idx.isLead(pid));
  const valid = (pid) => (idx.person(pid) ? pid : null);

  const [summary, setSummary] = useState(an?.summary ?? "");
  const [people, setPeople] = useState(() => (an?.people ?? []).map((p) => {
    const pid = isAdmin ? valid(p.person_id) : p.person_id; // el lead conserva ids que no ve, para pasarlos a Gus
    const priv = defaultPrivate(pid);
    return {
      ...p, person_id: pid,
      feedback: (p.feedback ?? []).map((f) => ({ ...f, keep: true, private: priv })),
      suggestions: (p.suggestions ?? []).map((s) => ({ ...s, decision: priv ? "propuesta" : "validada" })),
    };
  }));
  const [actions, setActions] = useState(() => (an?.actions ?? []).map((a) => {
    const pid = isAdmin ? valid(a.person_id) : a.person_id;
    return { ...a, keep: true, person_id: pid, priority: PRIORITIES.includes(a.priority) ? a.priority : "media", private: defaultPrivate(pid) };
  }));
  const [updates, setUpdates] = useState(() => (an?.suggestion_updates ?? []).filter((u) => data.suggestions.some((s) => s.id === u.suggestion_id)).map((u) => ({ ...u, keep: true })));
  const [coaching, setCoaching] = useState(() => (an?.coaching ?? []).map((c) => ({ ...c, decision: c.decision ?? null })));
  const [busy, setBusy] = useState(false);
  if (!m || !an) return html`<section class="page"><${Empty}>${t("Esta reunión no tiene análisis todavía.")}<//></section>`;

  const upP = (i, patch) => setPeople(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const upF = (i, k, patch) => upP(i, { feedback: people[i].feedback.map((f, j) => (j === k ? { ...f, ...patch } : f)) });
  const upS = (i, k, patch) => upP(i, { suggestions: people[i].suggestions.map((s, j) => (j === k ? { ...s, ...patch } : s)) });
  const upA = (i, patch) => setActions(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const setPersonFor = (i, v) => {
    const priv = defaultPrivate(v);
    upP(i, { person_id: v, feedback: people[i].feedback.map((f) => ({ ...f, private: priv })), suggestions: people[i].suggestions.map((s) => ({ ...s, decision: s.decision === "descartar" ? s.decision : priv ? "propuesta" : "validada" })) });
  };
  const myPeople = (p) => p.id !== myPid && !idx.isLead(p.id);
  const unmatched = isAdmin ? people.filter((p) => !p.person_id && (p.feedback.some((f) => f.keep) || p.suggestions.some((s) => s.decision !== "descartar"))).length : 0;
  const ownerOptions = (a) => {
    const l = idx.person(leadFor(a.person_id));
    const pp = idx.person(a.person_id);
    return [["gus", "Gus"], ...(l ? [["lead", l.full_name]] : []), ...(pp && pp.id !== l?.id ? [["persona", pp.full_name]] : [])];
  };
  const escalatedPeople = people.filter((p) => !isAdmin && p.person_id && !canHandle(p.person_id));
  const escalatedActions = actions.filter((a) => a.keep && a.person_id && !canHandle(a.person_id));
  const nameOf = (p) => idx.person(p.person_id)?.full_name ?? p.name;

  const apply = async () => {
    setBusy(true);
    try {
      const ins = [], sug = [], act = [], toGus = [];
      for (const p of people) {
        const handle = canHandle(p.person_id);
        if (isAdmin && !p.person_id) continue;
        for (const f of p.feedback.filter((f) => f.keep && f.body.trim())) {
          if (handle) ins.push({ person_id: p.person_id, meeting_id: m.id, kind: f.kind, category: f.category || null, body: f.body.trim(), private: isAdmin && f.private });
          else toGus.push({ type: "feedback", person_id: p.person_id, person_name: p.name, kind: f.kind, category: f.category || null, body: f.body.trim() });
        }
        for (const s of p.suggestions.filter((s) => s.decision !== "descartar")) {
          const row = { title: s.title, why: s.why, how: s.how, category: s.category, resources: s.resources ?? null };
          if (handle) sug.push({ person_id: p.person_id, meeting_id: m.id, ...row, source: "ia", status: s.decision });
          else toGus.push({ type: "suggestion", person_id: p.person_id, person_name: p.name, ...row, body: s.title });
        }
      }
      for (const a of actions.filter((a) => a.keep && a.body.trim())) {
        const pid = a.person_id ?? (isAdmin ? null : myPid);
        const owner = a.owner === "lead" ? leadFor(pid) : a.owner === "persona" ? pid : null;
        const row = { person_id: pid, owner_id: owner, meeting_id: m.id, body: a.body.trim(), due_date: a.due_date || null, priority: a.priority };
        // El lead guarda lo de su gente y lo general (queda como suyo); lo que es sobre él u otros líderes va a Gus
        if (isAdmin || canHandle(pid) || !a.person_id) act.push({ ...row, private: isAdmin && a.private });
        else toGus.push({ type: "action", person_name: idx.person(pid)?.full_name ?? "—", ...row });
      }
      if (ins.length) await api.insert("insights", ins);
      if (sug.length) await api.insert("suggestions", sug);
      if (act.length) await api.insert("actions", act);
      for (const u of updates.filter((u) => u.keep)) {
        await api.update("suggestions", u.suggestion_id, { outcome: u.outcome });
        await api.insert("suggestion_updates", [{ suggestion_id: u.suggestion_id, outcome: u.outcome, comment: u.comment }]);
      }
      await api.update("meetings", m.id, { summary, status: "aplicado", analysis: { ...an, coaching } });
      if (!isAdmin) {
        const author = idx.person(myPid)?.full_name ?? me?.email;
        const [rv] = await api.insert("reviews", [{ meeting_id: m.id, author_name: author, items: toGus, status: toGus.length ? "pendiente" : "revisado" }]);
        try { await api.fn("notify", { review_id: rv.id }); } catch (_) { /* el aviso es opcional */ }
      }
      await reload();
      toast(t("Aplicado: {i} notas, {a} pendientes, {s} ideas", { i: ins.length, a: act.length, s: sug.length }) + (toGus.length ? ` · ${t("{n} puntos enviados a Gus", { n: toGus.length })}` : ""));
      go("#/reunion/" + m.id);
    } catch (x) { toast(x.message, "bad"); setBusy(false); }
  };

  const visibleSugg = people.map((p, i) => ({ p, i })).filter(({ p }) => (canHandle(p.person_id) || (!isAdmin && !p.person_id)) && p.suggestions.length);
  return html`<section class="page review with-panel">
    <a href=${"#/reunion/" + m.id} class="back">${t("Reunión")}</a>
    <div class="split"><div class="split-main">
    <header class="page-head"><div><h1>${t("Revisa antes de guardar")}</h1>${an.source === "manual" && html`<p class="small gold-t">${t("Ordenado sin IA, a partir de tus notas.")}</p>`}<p class="muted">${t("{k} con {n}, {d}. Ajusta lo que haga falta; nada se guarda en los perfiles hasta que apliques.", { k: t(MEETING_KIND[m.kind]), n: lead?.full_name ?? "—", d: fmtDate(m.meeting_date) })}</p></div></header>

    <section class="block"><h2>${t("Resumen")}</h2><textarea rows="5" value=${summary} onInput=${(e) => setSummary(e.target.value)}></textarea>
      ${isAdmin && html`<p class="small muted">${t("El resumen lo ve la persona con quien fue la reunión. Quita lo que no deba ver.")}</p>`}</section>

    <section class="block">
      <h2>${t("Por persona")}</h2>
      ${isAdmin && html`<p class="small muted">${t("Lo que es sobre otros líderes sale como privado: solo tú lo ves. Desmárcalo si quieres compartirlo.")}</p>`}
      ${unmatched > 0 && html`<p class="warn">${t("{n} persona(s) sin identificar: elige quién es o se omitirá.", { n: unmatched })}</p>`}
      <div class="rv-people">
        ${people.map((p, i) => canHandle(p.person_id) || (!isAdmin && !p.person_id) ? html`<article class=${"rv-person" + (!p.person_id ? " unmatched" : "")} key=${i}>
          <header>
            <span class="small muted">${t("Dijo")}: “${p.name}”</span>
            <${PersonSelect} value=${p.person_id} onChange=${(v) => setPersonFor(i, v)} allowEmpty=${isAdmin ? t("¿Quién es?") : t("¿Quién es? (si no, va a Gus)")} only=${isAdmin ? undefined : myPeople} />
            ${isAdmin && idx.isLead(p.person_id) && p.person_id !== m.person_id && html`<span class="tag-lead">${t("Es líder: privado por defecto")}</span>`}
          </header>
          ${p.feedback.map((f, k) => html`<div class=${"rv-item" + (!f.keep ? " off" : "")}>
            <input type="checkbox" checked=${f.keep} onChange=${(e) => upF(i, k, { keep: e.target.checked })} aria-label=${t("Incluir")} />
            <select class="mini" value=${f.kind} onChange=${(e) => upF(i, k, { kind: e.target.value })}>${KIND_ORDER.map((x) => html`<option value=${x}>${t(KIND_LABEL[x])}</option>`)}</select>
            ${isAdmin && html`<label class="check small" title=${t("Solo tú la ves")}><input type="checkbox" checked=${f.private} onChange=${(e) => upF(i, k, { private: e.target.checked })} /> ${t("privada")}</label>`}
            <textarea rows="2" value=${f.body} onInput=${(e) => upF(i, k, { body: e.target.value })}></textarea>
          </div>`)}
        </article>` : null)}
      </div>
      ${escalatedPeople.length > 0 && html`<div class="to-gus">
        <h3>${t("Esto lo revisa Gus")}</h3>
        <p class="small muted">${t("Es sobre ti o sobre otros líderes. Se le envía a Gus al aplicar; no se guarda en ningún perfil hasta que él lo revise.")}</p>
        <ul>${escalatedPeople.map((p) => html`<li><strong>${nameOf(p)}</strong>: ${[...p.feedback.filter((f) => f.keep).map((f) => f.body), ...p.suggestions.filter((s) => s.decision !== "descartar").map((s) => s.title)].join(" · ")}</li>`)}</ul>
      </div>`}
    </section>

    <section class="block"><h2>${t("Siguientes pasos")}</h2>
      <div class="rv-actions">
        <div class=${"rva-row rva-head" + (isAdmin ? " adm" : "")}><span></span><span>${t("Tarea")}</span><span>${t("Sobre quién")}</span><span>${t("A cargo de")}</span><span>${t("Fecha límite")}</span><span>${t("Prioridad")}</span>${isAdmin && html`<span>${t("Privada")}</span>`}</div>
        ${actions.map((a, i) => !isAdmin && a.person_id && !canHandle(a.person_id) ? null : html`<div class=${"rva-row" + (isAdmin ? " adm" : "") + (!a.keep ? " off" : "")} key=${i}>
          <input type="checkbox" checked=${a.keep} onChange=${(e) => upA(i, { keep: e.target.checked })} aria-label=${t("Incluir")} />
          <input value=${a.body} onInput=${(e) => upA(i, { body: e.target.value })} aria-label=${t("Tarea")} />
          <${PersonSelect} value=${a.person_id} onChange=${(v) => upA(i, { person_id: v, private: defaultPrivate(v) })} allowEmpty=${t("General")} only=${isAdmin ? undefined : myPeople} />
          <select value=${a.owner} onChange=${(e) => upA(i, { owner: e.target.value })} aria-label=${t("A cargo de")}>
            ${ownerOptions(a).map(([v, n]) => html`<option value=${v}>${n}</option>`)}
          </select>
          <input type="date" value=${a.due_date ?? ""} onInput=${(e) => upA(i, { due_date: e.target.value })} aria-label=${t("Fecha límite")} />
          <select class=${"prio-sel pr-" + light(a)} value=${a.priority} onChange=${(e) => upA(i, { priority: e.target.value })} aria-label=${t("Prioridad")}>
            ${PRIORITIES.map((x) => html`<option value=${x}>${t(x)}</option>`)}
          </select>
          ${isAdmin && html`<input type="checkbox" checked=${a.private} onChange=${(e) => upA(i, { private: e.target.checked })} aria-label=${t("Privada")} />`}
        </div>`)}
      </div>
      <button class="link" onClick=${() => setActions([...actions, { body: "", person_id: null, owner: isAdmin ? "gus" : "lead", due_date: null, priority: "media", private: false, keep: true }])}>${t("Agregar paso")}</button>
      ${!isAdmin && escalatedActions.length > 0 && html`<p class="small muted">${t("{n} paso(s) sobre ti u otros líderes se envían a Gus.", { n: escalatedActions.length })}</p>`}
    </section>

    ${updates.length > 0 && html`<section class="block"><h2>${t("Resultados reportados")}</h2>
      ${updates.map((u, i) => {
        const s = data.suggestions.find((x) => x.id === u.suggestion_id);
        return html`<label class="check rv-up" key=${i}><input type="checkbox" checked=${u.keep} onChange=${(e) => setUpdates(updates.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
          <span><strong>${s?.title}</strong> (${idx.person(s?.person_id)?.full_name}): <b>${t(u.outcome)}</b>. ${u.comment}</span></label>`;
      })}
    </section>`}

    <div class="sticky-bar"><span class="muted small">${isAdmin ? t("Se guardará en los perfiles de cada persona.") : t("Se guarda en los perfiles de tu gente y Gus recibe un aviso.")}</span><button class="primary" disabled=${busy} onClick=${apply}>${busy ? t("Aplicando…") : t("Aplicar a perfiles")}</button></div>
    </div>
    <aside class="coach-panel" aria-label=${t("Recomendaciones de liderazgo")}>
      <h2>${t("Recomendaciones de liderazgo")}</h2>
      ${!coaching.length && an.source === "manual"
        ? html`<p class="small muted">${t("Ordenado sin IA: no hay recomendaciones. Si las necesitas, puedes pedirlas después desde la reunión.")}</p>`
        : coaching.length
          ? html`<p class="small muted">${t("Para quien dirige la reunión: cómo acompañar a cada persona. Marca las que te sirven.")}</p>
              ${coaching.map((c, i) => html`<${CoachCard} c=${c} onDecide=${(d) => setCoaching(coaching.map((x, j) => (j === i ? { ...x, decision: d } : x)))} key=${i} />`)}`
          : html`<p class="small muted">${t("Esta reunión todavía no tiene recomendaciones de liderazgo.")}</p>`}
      ${visibleSugg.length > 0 && html`<h2 class="mt">${t("Métodos por persona")}</h2>
        <p class="small muted">${isAdmin ? t("Decide cuáles se comparten con el líder.") : t("Decide cuáles guardas en el plan de cada persona.")}</p>
        ${visibleSugg.map(({ p, i }) => p.suggestions.map((sg, k) => html`<article class=${"coach method" + (sg.decision === "descartar" ? " off" : "")} key=${i + "-" + k}>
          <header><span class="for">${t("Para")}: ${nameOf(p)}</span>${sg.category && html`<span class="small muted">${t(sg.category)}</span>`}</header>
          <h3>${sg.title}</h3>
          ${sg.why && html`<p class="why">${sg.why}</p>`}
          <label class="small">${t("Pasos")}<textarea rows="4" value=${sg.how} onInput=${(e) => upS(i, k, { how: e.target.value })}></textarea></label>
          ${sg.resources && html`<p class="small muted">${sg.resources}</p>`}
          <select value=${sg.decision} onChange=${(e) => upS(i, k, { decision: e.target.value })} aria-label=${t("Decisión")}>
            ${isAdmin
              ? html`<option value="validada">${t("Validar y compartir")}</option><option value="propuesta">${t("Guardar solo para mí")}</option>`
              : html`<option value="validada">${t("Guardar en su plan")}</option><option value="en uso">${t("La voy a usar ya")}</option>`}
            <option value="descartar">${t("Descartar")}</option>
          </select>
        </article>`))}`}
    </aside>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------
// Pendientes con resumen por responsable (Cambio 5)
// ---------------------------------------------------------------------
function PendingView() {
  const { data, isAdmin, me, idx, api, reload } = useApp();
  const [owner, setOwner] = useState("todos");
  const [adding, setAdding] = useState("");
  const all = data.actions.filter((a) => OPEN.includes(a.status));
  const key = (a) => a.owner_id ?? "gus";
  const summary = {};
  for (const a of all) {
    const k = key(a);
    summary[k] ??= { r: 0, y: 0, g: 0, total: 0 };
    summary[k][light(a)]++; summary[k].total++;
  }
  const rows = Object.entries(summary).sort((a, b) => b[1].r - a[1].r || b[1].total - a[1].total);
  const open = owner === "todos" ? all : all.filter((a) => key(a) === owner);
  const sortFn = (a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
  const buckets = [
    ["late", t("Vencidos"), open.filter(isOverdue)],
    ["week", t("Esta semana"), open.filter((a) => a.due_date && daysUntil(a.due_date) >= 0 && daysUntil(a.due_date) <= 7)],
    ["later", t("Más adelante"), open.filter((a) => a.due_date && daysUntil(a.due_date) > 7)],
    ["none", t("Sin fecha"), open.filter((a) => !a.due_date)],
  ];
  const ownerLabel = (k) => (k === "gus" ? "Gus" : idx.person(k)?.full_name ?? "—");
  const add = async (e) => {
    e.preventDefault();
    if (!adding.trim()) return;
    try {
      await api.insert("actions", [{ body: adding.trim(), owner_id: isAdmin ? null : me?.person_id, person_id: isAdmin ? null : me?.person_id, priority: "media" }]);
      setAdding(""); reload();
    } catch (x) { toast(x.message, "bad"); }
  };
  const pick = (k) => setOwner(owner === k ? "todos" : k);
  return html`<section class="page">
    <header class="page-head"><div><h1>${t("Pendientes")}</h1><p class="muted">${t("Todo lo abierto, ordenado por fecha. Rojo: vencido o prioridad alta; amarillo: media; verde: baja.")}</p></div></header>
    <div class="pend-grid">
      <div class="pend-main">
        <form class="row add" onSubmit=${add}><input class="grow" placeholder=${t("Agregar un pendiente rápido")} value=${adding} onInput=${(e) => setAdding(e.target.value)} /><button>${t("Agregar")}</button></form>
        ${owner !== "todos" && html`<p class="filter-on">${t("Mostrando lo que está a cargo de {n}.", { n: ownerLabel(owner) })} <button class="link" onClick=${() => setOwner("todos")}>${t("Ver todos")}</button></p>`}
        ${open.length === 0 && html`<${Empty}>${t("No hay pendientes abiertos con este filtro.")}<//>`}
        ${buckets.map(([k, title, list]) => list.length ? html`<section class="block" key=${k}><h2 class=${k === "late" ? "late-h" : ""}>${title} <span class="muted">${list.length}</span></h2><${ActionTable} actions=${list.sort(sortFn)} /></section>` : null)}
      </div>
      <aside class="pend-summary">
        <h2>${t("Resumen por responsable")}</h2>
        <table class="tbl sum">
          <thead><tr><th>${t("A cargo de")}</th><th title=${t("Vencido o alta")}><i class="dot r"></i></th><th title=${t("Media")}><i class="dot y"></i></th><th title=${t("Baja")}><i class="dot g"></i></th><th>${t("Total")}</th></tr></thead>
          <tbody>
            ${rows.map(([k, v]) => html`<tr class=${owner === k ? "on" : ""} onClick=${() => pick(k)} tabindex="0" onKeyDown=${(e) => e.key === "Enter" && pick(k)} key=${k}>
              <td>${ownerLabel(k)}</td><td class=${v.r ? "n-r" : "muted"}>${v.r}</td><td>${v.y}</td><td>${v.g}</td><td><strong>${v.total}</strong></td></tr>`)}
          </tbody>
        </table>
        ${rows.length === 0 && html`<${Empty}>${t("Nada abierto.")}<//>`}
        <p class="small muted">${t("Haz clic en una fila para ver solo sus pendientes.")}</p>
      </aside>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------
// Por revisar (admin): lo que mandan los leads + ideas de la IA
// ---------------------------------------------------------------------
function ReviewItem({ it, meeting, onChange }) {
  const { idx } = useApp();
  return html`<div class=${"rq-item" + (!it.keep ? " off" : "")}>
    <input type="checkbox" checked=${it.keep} onChange=${(e) => onChange({ keep: e.target.checked })} aria-label=${t("Incluir")} />
    <div class="grow stack-s">
      <div class="row">
        <span class="pill">${it.type === "feedback" ? t(KIND_LABEL[it.kind] ?? "Observación") : it.type === "suggestion" ? t("Idea / método") : t("Pendiente")}</span>
        <${PersonSelect} value=${idx.person(it.person_id) ? it.person_id : null} onChange=${(v) => onChange({ person_id: v, private: idx.isLead(v) && v !== meeting?.person_id })} allowEmpty=${t("¿Quién es? ({n})", { n: it.person_name ?? "—" })} />
        <label class="check small"><input type="checkbox" checked=${it.private} onChange=${(e) => onChange({ private: e.target.checked })} /> ${t("privada")}</label>
      </div>
      ${it.type === "suggestion"
        ? html`<strong>${it.title}</strong><p class="small muted">${it.why}</p><textarea rows="2" value=${it.how ?? ""} onInput=${(e) => onChange({ how: e.target.value })}></textarea>`
        : html`<textarea rows="2" value=${it.body} onInput=${(e) => onChange({ body: e.target.value })}></textarea>`}
    </div>
  </div>`;
}

function LeadReviewCard({ rv }) {
  const { idx, api, reload } = useApp();
  const meeting = idx.meeting(rv.meeting_id);
  const [items, setItems] = useState(() => (rv.items ?? []).map((it) => ({ ...it, keep: true, private: idx.isLead(it.person_id) && it.person_id !== meeting?.person_id })));
  const [busy, setBusy] = useState(false);
  const up = (i, patch) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const done = async (applyItems) => {
    setBusy(true);
    try {
      if (applyItems) {
        const use = items.filter((x) => x.keep && idx.person(x.person_id));
        const ins = use.filter((x) => x.type === "feedback").map((x) => ({ person_id: x.person_id, meeting_id: rv.meeting_id, kind: x.kind ?? "observación", category: x.category ?? null, body: x.body, private: x.private }));
        const sug = use.filter((x) => x.type === "suggestion").map((x) => ({ person_id: x.person_id, meeting_id: rv.meeting_id, title: x.title, why: x.why, how: x.how, category: x.category, resources: x.resources ?? null, source: "ia", status: x.private ? "propuesta" : "validada" }));
        const act = use.filter((x) => x.type === "action").map((x) => ({ person_id: x.person_id, owner_id: x.owner_id ?? null, meeting_id: rv.meeting_id, body: x.body, due_date: x.due_date ?? null, priority: x.priority ?? "media", private: x.private }));
        if (ins.length) await api.insert("insights", ins);
        if (sug.length) await api.insert("suggestions", sug);
        if (act.length) await api.insert("actions", act);
      }
      await api.update("reviews", rv.id, { status: "revisado", reviewed_at: new Date().toISOString() });
      toast(applyItems ? t("Aplicado") : t("Descartado")); reload();
    } catch (x) { toast(x.message, "bad"); setBusy(false); }
  };
  return html`<article class="rq">
    <header><div><strong>${rv.author_name ?? "—"}</strong> <span class="muted">${t("subió")}</span> ${meeting ? html`<a href=${"#/reunion/" + meeting.id}>${meeting.title || t("{k} con {n}", { k: t(MEETING_KIND[meeting.kind]), n: idx.person(meeting.person_id)?.full_name ?? "—" })}</a>` : t("una reunión")}
      <span class="small muted"> · ${fmtDate(rv.created_at)}</span></div></header>
    ${items.map((it, i) => html`<${ReviewItem} it=${it} meeting=${meeting} onChange=${(p) => up(i, p)} key=${i} />`)}
    <div class="row end"><button disabled=${busy} onClick=${() => done(false)}>${t("Descartar todo")}</button><button class="primary" disabled=${busy} onClick=${() => done(true)}>${t("Aplicar seleccionados")}</button></div>
  </article>`;
}

function ValidateView() {
  const { data } = useApp();
  const list = data.suggestions.filter((s) => s.status === "propuesta");
  const rvs = data.reviews.filter((r) => r.status === "pendiente").sort((a, b) => b.created_at.localeCompare(a.created_at));
  return html`<section class="page narrow">
    <header class="page-head"><div><h1>${t("Por revisar")}</h1><p class="muted">${t("Lo que te pasaron los leads y las ideas de la IA que solo ves tú.")}</p></div></header>
    <section class="block"><h2>${t("Enviado por los leads")} <span class="muted">${rvs.length}</span></h2>
      ${rvs.length ? rvs.map((r) => html`<${LeadReviewCard} rv=${r} key=${r.id} />`) : html`<${Empty}>${t("Nada pendiente de los leads.")}<//>`}</section>
    <section class="block"><h2>${t("Ideas de la IA por validar")} <span class="muted">${list.length}</span></h2>
      ${list.length === 0 && html`<${Empty}>${t("No hay ideas pendientes de validar.")}<//>`}
      ${[...new Set(list.map((s) => s.person_id))].map((pid) => html`<div class="block-s" key=${pid}><h3><${PersonLink} id=${pid} /></h3>
        ${list.filter((s) => s.person_id === pid).map((s) => html`<${SuggestionCard} s=${s} key=${s.id} />`)}</div>`)}
    </section>
  </section>`;
}

// ---------------------------------------------------------------------
// Banco de ideas (Cambio 4)
// ---------------------------------------------------------------------
const IDEA_STATUS = ["nueva", "en análisis", "en curso", "resuelta", "descartada"];
const HORIZON = { corto: "Corto plazo", mediano: "Mediano plazo", largo: "Largo plazo" };

function IdeaForm({ onClose }) {
  const { api, reload, data, me, idx, isAdmin } = useApp();
  const myGroups = me?.person_id ? idx.groupsLedBy(me.person_id) : [];
  const [f, setF] = useState({ kind: "problema", title: "", description: "", horizon: "corto", group_id: myGroups[0]?.id ?? "", raised_by: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.insert("ideas", [{ ...f, group_id: f.group_id || null, raised_by: f.raised_by || null, author_name: idx.person(me?.person_id)?.full_name ?? (isAdmin ? "Gus" : me?.email) }]);
      toast(t("Guardado en el banco")); reload(); onClose();
    } catch (x) { toast(x.message, "bad"); setBusy(false); }
  };
  return html`<${Modal} title=${t("Nueva idea o problema")} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <span class="seg" role="group">
        <button type="button" class=${f.kind === "problema" ? "on" : ""} onClick=${() => setF({ ...f, kind: "problema" })}>${t("Problema")}</button>
        <button type="button" class=${f.kind === "idea" ? "on" : ""} onClick=${() => setF({ ...f, kind: "idea" })}>${t("Idea de mejora")}</button>
      </span>
      <label>${t("Título")}<input required value=${f.title} onInput=${set("title")} placeholder=${t("Ej.: Las imágenes en Bynder cargan muy lento")} /></label>
      <label>${t("Detalle")}<textarea rows="4" value=${f.description} onInput=${set("description")} placeholder=${t("Qué pasa, qué ya intentaron, a quién afecta.")}></textarea></label>
      <div class="row">
        <label class="grow">${t("Plazo")}<select value=${f.horizon} onChange=${set("horizon")}>${Object.entries(HORIZON).map(([k, v]) => html`<option value=${k}>${t(v)}</option>`)}</select></label>
        <label class="grow">${t("Grupo")}<select value=${f.group_id} onChange=${set("group_id")}><option value="">${t("General")}</option>${data.groups.map((g) => html`<option value=${g.id}>${g.name}</option>`)}</select></label>
      </div>
      <label>${t("¿Quién lo planteó? (opcional)")}<input value=${f.raised_by} onInput=${set("raised_by")} placeholder=${t("Ej.: alguien del equipo, en el chat")} /></label>
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary" disabled=${busy}>${t("Guardar")}</button></div>
    </form>
  <//>`;
}

function IdeaCard({ idea }) {
  const { api, reload, isAdmin, session, idx } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = isAdmin || idea.created_by === session.user.id;
  const sol = idea.ai_solutions;
  const g = idx.group(idea.group_id);
  const ask = async () => {
    setBusy(true); setOpen(true);
    try { await api.fn("idea_solutions", { idea_id: idea.id, lang: LANG }); await reload(); } catch (x) { toast(x.message, "bad"); }
    setBusy(false);
  };
  const setStatus = async (status) => { try { await api.update("ideas", idea.id, { status }); reload(); } catch (x) { toast(x.message, "bad"); } };
  const del = async () => { if (confirm(t("¿Borrar esta idea?"))) { try { await api.remove("ideas", idea.id); reload(); } catch (x) { toast(x.message, "bad"); } } };
  return html`<article class=${"idea k-" + idea.kind} style=${`--c:${g?.color ?? "#94a3b8"}`}>
    <header onClick=${() => setOpen(!open)}>
      <div class="grow">
        <span class=${"pill " + (idea.kind === "problema" ? "p-prob" : "p-idea")}>${idea.kind === "problema" ? t("Problema") : t("Idea")}</span>
        <h4>${idea.title}</h4>
        <span class="small muted">${[g?.name, idea.author_name, t(HORIZON[idea.horizon]), fmtDate(idea.created_at)].filter(Boolean).join(", ")}</span>
      </div>
      <span class=${"pill st-i-" + slug(idea.status)}>${t(idea.status)}</span>
    </header>
    ${open && html`<div class="idea-body">
      ${idea.description && html`<p>${idea.description}</p>`}
      ${idea.raised_by && html`<p class="small muted">${t("Lo planteó")}: ${idea.raised_by}</p>`}
      ${busy ? html`<${Busy} label=${t("La IA está buscando soluciones…")} />` : sol && html`<div class="sol">
        <p class="lede">${sol.diagnosis}</p>
        ${sol.quick_win && html`<p class="quick"><strong>${t("Esta semana")}:</strong> ${sol.quick_win}</p>`}
        <div class="opts">${(sol.options ?? []).map((o) => html`<div class="opt">
          <strong>${o.title}</strong>
          <span class="small muted">${t("Esfuerzo")}: ${t(o.effort)}, ${t("impacto")}: ${t(o.impact)}, ${t(HORIZON[o.horizon] ?? o.horizon)}</span>
          <p>${o.description}</p>
          ${o.steps?.length > 0 && html`<ol>${o.steps.map((s) => html`<li>${s}</li>`)}</ol>`}
        </div>`)}</div>
        ${sol.questions?.length > 0 && html`<p class="small"><strong>${t("Falta saber")}:</strong> ${sol.questions.join(" / ")}</p>`}
        ${sol.related?.length > 0 && html`<p class="small muted">${t("Relacionadas")}: ${sol.related.join(", ")}</p>`}
      </div>`}
      <div class="row">
        <button class="primary" disabled=${busy} onClick=${ask}>${sol ? t("Buscar otras soluciones") : t("Buscar soluciones con IA")}</button>
        ${canEdit && html`<select class="mini" value=${idea.status} onChange=${(e) => setStatus(e.target.value)} aria-label=${t("Estado")}>${IDEA_STATUS.map((s) => html`<option value=${s}>${t(s)}</option>`)}</select>`}
        ${canEdit && html`<button class="link" onClick=${del}>${t("Borrar")}</button>`}
      </div>
    </div>`}
  </article>`;
}

function IdeasView() {
  const { data } = useApp();
  const [modal, setModal] = useState(false);
  const [st, setSt] = useState("abiertas");
  const [kind, setKind] = useState("todas");
  let list = [...data.ideas].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (st === "abiertas") list = list.filter((i) => !["resuelta", "descartada"].includes(i.status));
  else if (st !== "todas") list = list.filter((i) => i.status === st);
  if (kind !== "todas") list = list.filter((i) => i.kind === kind);
  return html`<section class="page narrow">
    <header class="page-head"><div><h1>${t("Banco de ideas")}</h1><p class="muted">${t("Problemas e ideas de mejora de todos los grupos. Cualquier lead puede sumar y pedirle soluciones a la IA.")}</p></div>
      <button class="primary" onClick=${() => setModal(true)}>${t("Agregar")}</button></header>
    <div class="row filters">
      <select value=${st} onChange=${(e) => setSt(e.target.value)} aria-label=${t("Estado")}><option value="abiertas">${t("Abiertas")}</option><option value="todas">${t("Todas")}</option>${IDEA_STATUS.map((s) => html`<option value=${s}>${t(s)}</option>`)}</select>
      <select value=${kind} onChange=${(e) => setKind(e.target.value)} aria-label=${t("Tipo")}><option value="todas">${t("Problemas e ideas")}</option><option value="problema">${t("Solo problemas")}</option><option value="idea">${t("Solo ideas")}</option></select>
    </div>
    ${list.length === 0 && html`<${Empty}>${t("Nada por aquí. Agrega el primer problema o idea del equipo.")}<//>`}
    <div class="ideas">${list.map((i) => html`<${IdeaCard} idea=${i} key=${i.id} />`)}</div>
    ${modal && html`<${IdeaForm} onClose=${() => setModal(false)} />`}
  </section>`;
}

// ---------------------------------------------------------------------
// Accesos (solo admin)
// ---------------------------------------------------------------------
function AccessView() {
  const { data, api, reload, idx } = useApp();
  const [modal, setModal] = useState(null);
  const leads = data.people.filter((p) => idx.isLead(p.id) || p.email);
  const profileOf = (pid) => data.profiles.find((x) => x.person_id === pid);
  return html`<section class="page narrow">
    <header class="page-head"><div><h1>${t("Accesos")}</h1><p class="muted">${t("Crea el usuario de cada colaborador. Cada uno ve solo su grupo, sus reuniones contigo y las ideas que validaste.")}</p></div>
      <button onClick=${() => setModal({ edit: true })}>${t("Agregar persona")}</button></header>
    <table class="tbl access">
      <thead><tr><th>${t("Persona")}</th><th>${t("Usuario")}</th><th></th></tr></thead>
      <tbody>${leads.map((p) => {
        const pr = profileOf(p.id);
        return html`<tr key=${p.id}><td><${PersonLink} id=${p.id} /><div class="small muted">${idx.group(p.group_id)?.name ?? ""}</div></td>
          <td>${pr ? html`<span>${pr.email}</span>` : html`<span class="muted">${p.email ?? t("sin correo")}</span>`}</td>
          <td class="right">${pr ? html`<button onClick=${() => setModal({ reset: pr, person: p })}>${t("Nueva contraseña")}</button>` : html`<button class="primary" onClick=${() => setModal({ create: p })}>${t("Crear acceso")}</button>`}</td></tr>`;
      })}</tbody>
    </table>
    <h2 class="mt">${t("Todos los usuarios")}</h2>
    <table class="tbl"><tbody>${data.profiles.map((pr) => html`<tr key=${pr.id}><td>${pr.email}</td><td>${pr.role === "admin" ? "Admin" : t("Lead")}</td>
      <td>${pr.role !== "admin" && html`<${PersonSelect} value=${pr.person_id} onChange=${async (v) => { await api.update("profiles", pr.id, { person_id: v }); reload(); }} allowEmpty=${t("Sin vincular")} />`}</td></tr>`)}</tbody></table>
    ${modal?.create && html`<${CredModal} person=${modal.create} onClose=${() => setModal(null)} />`}
    ${modal?.reset && html`<${CredModal} person=${modal.person} profile=${modal.reset} onClose=${() => setModal(null)} />`}
    ${modal?.edit && html`<${EditPerson} person=${{}} onClose=${() => setModal(null)} />`}
  </section>`;
}

function CredModal({ person, profile, onClose }) {
  const { api, reload } = useApp();
  const [email, setEmail] = useState(profile?.email ?? person.email ?? "");
  const [pw, setPw] = useState(genPassword());
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (profile) await api.fn("reset_password", { user_id: profile.id, password: pw });
      else await api.fn("create_user", { email, password: pw, person_id: person.id });
      setDone(true); reload();
    } catch (x) { toast(x.message, "bad"); }
    setBusy(false);
  };
  const msg = t("Hola {n}, ya tienes acceso a Team Coach.\nEnlace: {u}\nUsuario: {e}\nContraseña: {p}\nSi quieres, puedes cambiarla desde adentro.", { n: firstName(person.full_name), u: location.origin + location.pathname, e: email, p: pw });
  return html`<${Modal} title=${(profile ? t("Nueva contraseña para {n}", { n: firstName(person.full_name) }) : t("Acceso para {n}", { n: firstName(person.full_name) }))} onClose=${onClose}>
    ${done ? html`<div class="stack"><p>${t("Listo. Envíale esto:")}</p><pre class="cred">${msg}</pre>
      <div class="row end"><button onClick=${() => { navigator.clipboard?.writeText(msg); toast(t("Copiado")); }}>${t("Copiar mensaje")}</button><button class="primary" onClick=${onClose}>${t("Cerrar")}</button></div></div>`
    : html`<form class="stack" onSubmit=${run}>
      <label>${t("Correo")}${profile ? html`<input value=${email} disabled />` : html`<input type="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} />`}</label>
      <label>${t("Contraseña")}<div class="row"><input class="grow" required minlength="8" value=${pw} onInput=${(e) => setPw(e.target.value)} /><button type="button" onClick=${() => setPw(genPassword())}>${t("Generar otra")}</button></div></label>
      <div class="row end"><button type="button" onClick=${onClose}>${t("Cancelar")}</button><button class="primary" disabled=${busy}>${busy ? t("Creando…") : profile ? t("Cambiar contraseña") : t("Crear acceso")}</button></div>
    </form>`}
  <//>`;
}

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------
function Shell({ api, session, onLang }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [pwModal, setPwModal] = useState(false);
  const [menu, setMenu] = useState(false);
  const route = useRoute();

  const reload = useCallback(async () => {
    try { setData(await api.loadAll()); } catch (x) { setErr(x.message); }
  }, []);
  useEffect(() => { reload(); }, []);
  // Cambio 13: Bamboo se carga aparte (si falla, el resto de la app sigue igual)
  const [bamboo, setBamboo] = useState(null);
  const meRole = data?.profiles.find((p) => p.id === session.user.id)?.role;
  const reloadBamboo = useCallback(async () => {
    if (!api.loadBamboo) return setBamboo({ available: false, error: "demo" });
    setBamboo(await api.loadBamboo({ admin: meRole === "admin" }));
  }, [meRole]);
  useEffect(() => { if (data) reloadBamboo(); }, [!!data, meRole]);
  useEffect(() => setMenu(false), [route.page, route.id]);
  const idx = useMemo(() => (data ? buildIdx(data) : null), [data]);
  const me = data?.profiles.find((p) => p.id === session.user.id);
  // El idioma guardado en el perfil manda (una vez, al entrar)
  const [langSynced, setLangSynced] = useState(false);
  useEffect(() => {
    if (me && !langSynced) {
      setLangSynced(true);
      let chosen = null;
      try { chosen = localStorage.getItem("tc-lang"); } catch (_) {}
      if (chosen && chosen !== me.lang) api.rpc("set_lang", { l: chosen }).catch(() => {});
      else if (!chosen && me.lang && me.lang !== LANG) onLang(me.lang);
    }
  }, [me]);

  if (err) return html`<main class="center"><p class="error">${t("No pude cargar los datos: {e}", { e: err })}</p><button onClick=${() => api.signOut()}>${t("Salir")}</button></main>`;
  if (!data) return html`<main class="center"><${Busy} /></main>`;

  const profile = me ?? { role: "lead" };
  const isAdmin = profile.role === "admin";
  const reviewsPending = data.reviews.filter((r) => r.status === "pendiente").length;
  const toReview = data.suggestions.filter((s) => s.status === "propuesta").length + reviewsPending;
  const lateCount = data.actions.filter(isOverdue).length;
  const ctx = { api, data, reload, idx, me: profile, isAdmin, session, reviewsPending, bamboo, reloadBamboo };
  const setLang = async (l) => { onLang(l); try { await api.rpc("set_lang", { l }); } catch (_) {} };

  let page;
  switch (route.page) {
    case "persona": page = html`<${PersonView} id=${route.id} key=${route.id} />`; break;
    case "reuniones": page = html`<${MeetingsView} />`; break;
    case "reunion": page = html`<${MeetingView} id=${route.id} key=${route.id} />`; break;
    case "nueva": page = html`<${NewMeeting} />`; break;
    case "revisar": page = html`<${Review} id=${route.id} key=${route.id} />`; break;
    case "pendientes": page = html`<${PendingView} />`; break;
    case "ideas": page = html`<${IdeasView} />`; break;
    case "validar": page = isAdmin ? html`<${ValidateView} />` : null; break;
    case "accesos": page = isAdmin ? html`<${AccessView} />` : null; break;
    case "horas": page = html`<${HorasView} />`; break;
    case "reglas": page = isAdmin ? html`<${ReglasView} />` : null; break;
    default: page = html`<${TeamView} />`;
  }
  const nav = [
    ["equipo", t("Equipo"), null],
    ["horas", t("Horas"), null],
    ["reuniones", t("Reuniones"), null],
    ["pendientes", t("Pendientes"), lateCount || null],
    ["ideas", t("Banco de ideas"), null],
    ...(isAdmin ? [["validar", t("Por revisar"), toReview || null], ["accesos", t("Accesos"), null], ["reglas", t("Reglas"), null]] : []),
  ];
  const active = { persona: "equipo", reunion: "reuniones", revisar: "reuniones" }[route.page] ?? route.page;

  return html`<${Ctx.Provider} value=${ctx}>
    <div class="shell">
      <aside class=${"side" + (menu ? " open" : "")}>
        <div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>Team Coach
          <button class="icon burger" aria-label=${t("Menú")} onClick=${() => setMenu(!menu)}>☰</button></div>
        <nav>
          <a class=${"nav-new" + (active === "nueva" ? " on" : "")} href="#/nueva">${t("Nueva reunión")}</a>
          ${nav.map(([k, label, badge]) => html`<a class=${active === k ? "on" : ""} href=${"#/" + k}>${label}${badge && html`<span class="badge">${badge}</span>`}</a>`)}
        </nav>
        <div class="me">
          <span class="small">${profile.email ?? session.user.email}</span>
          ${api.demo && html`<span class="small gold-t">${t("Modo demo")}</span>`}
          <${LangSwitch} onLang=${setLang} />
          <button class="link small" onClick=${() => setPwModal(true)}>${t("Cambiar contraseña")}</button>
          <button class="link small" onClick=${() => api.signOut()}>${t("Salir")}</button>
        </div>
      </aside>
      <main class="main">${page ?? html`<section class="page"><${Empty}>${t("No tienes acceso a esta sección.")}<//></section>`}</main>
    </div>
    ${pwModal && html`<${ChangePassword} onClose=${() => setPwModal(false)} />`}
    <datalist id="cats">${CATS.map((c) => html`<option value=${c} />`)}</datalist>
  <//>`;
}

function Root({ api }) {
  const [session, setSession] = useState(undefined);
  const [, setLangTick] = useState(0);
  const onLang = (l) => {
    LANG = l === "en" ? "en" : "es";
    try { localStorage.setItem("tc-lang", LANG); } catch (_) {}
    document.documentElement.lang = LANG;
    setLangTick((x) => x + 1);
  };
  useEffect(() => {
    document.documentElement.lang = LANG;
    api.session().then(setSession);
    api.onAuth((s) => setSession(s));
  }, []);
  if (session === undefined) return html`<main class="center"><${Busy} /></main>`;
  return html`${session ? html`<${Shell} api=${api} session=${session} onLang=${onLang} key=${session.user.id} />` : html`<${Login} api=${api} onLang=${onLang} />`}<${Toasts} />`;
}

export function start(api) {
  render(html`<${Root} api=${api} />`, document.getElementById("app"));
}

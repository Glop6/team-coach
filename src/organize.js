// Cambio 10: "Ordenar sin IA". Convierte notas con un formato simple en el mismo
// formato que devuelve la IA, sin llamar a ninguna IA (no cuesta nada).
//
//   Updates                         ← sección de novedades
//   Ana: más tranquila al hablar    ← "Nombre: texto"  (o "Nombre, texto")
//   - va mejor con los tiempos      ← sin nombre = la persona de la reunión (1:1)
//
//   Pendientes                      ← sección de siguientes pasos
//   Marco: validar el script 28/10 (alta)
//   - terminar la guía de SS        ← sin nombre = la persona de la reunión
//
// Opcional: "(+)" al inicio = fortaleza, "(-)" = a mejorar. En pendientes: "(alta)", "(baja)" y una fecha
// 28/10, 28/10/2026 o 2026-10-28.

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.\s]+/g, " ").trim();

const UPDATES = /^(updates?|novedades|notas|actualizaciones|resumen|feedback|comentarios)$/;
const ACTIONS = /^(pendientes?|next steps?|siguientes pasos|tareas|acciones|to ?dos?|acuerdos)$/;

// Busca a quién se refiere un nombre. Si hay varios con el mismo nombre, prefiere el grupo de la reunión.
export function makeResolver(people, preferGroupId) {
  const keys = new Map();
  const add = (k, p) => {
    k = norm(k);
    if (!k) return;
    if (!keys.has(k)) keys.set(k, []);
    if (!keys.get(k).includes(p)) keys.get(k).push(p);
  };
  for (const p of people) {
    const parts = p.full_name.split(/\s+/);
    add(p.full_name, p);
    add(parts[0], p);
    if (parts[1]) { add(`${parts[0]} ${parts[1]}`, p); add(`${parts[0]} ${parts[1][0]}`, p); }
    if (p.nickname) String(p.nickname).split(/[,/;]/).forEach((n) => add(n, p));
  }
  return (name) => {
    const list = keys.get(norm(name)) ?? [];
    if (list.length === 1) return list[0];
    if (list.length > 1) {
      const inGroup = list.filter((p) => p.group_id && p.group_id === preferGroupId);
      if (inGroup.length === 1) return inGroup[0];
    }
    return null;
  };
}

function parseDate(text, today) {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, rest: text.replace(m[0], "") };
  m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const [y0, mo0] = today.split("-").map(Number);
    let y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : y0;
    const mo = Number(m[2]), d = Number(m[1]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return { date: null, rest: text };
    if (!m[3] && mo < mo0 - 6) y += 1; // "15/01" escrito en octubre = enero del próximo año
    return { date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, rest: text.replace(m[0], "") };
  }
  return { date: null, rest: text };
}

const clean = (s) => s.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "").trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function organize(text, { meetingPerson, people, isLead, today }) {
  const resolve = makeResolver(people, meetingPerson?.group_id);
  // En un 1:1 con alguien que no es líder, lo que no tiene nombre es sobre esa persona
  const defaultPerson = meetingPerson && !isLead(meetingPerson.id) ? meetingPerson : null;
  const byPerson = new Map();
  const personEntry = (p, said) => {
    const key = p ? p.id : "?" + norm(said);
    if (!byPerson.has(key)) byPerson.set(key, { name: p ? p.full_name : said, person_id: p ? p.id : null, feedback: [], suggestions: [] });
    return byPerson.get(key);
  };
  const actions = [];
  const general = [];
  let section = "updates";

  for (let raw of String(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const head = norm(line.replace(/^#+/, "").replace(/:$/, ""));
    if (UPDATES.test(head)) { section = "updates"; continue; }
    if (ACTIONS.test(head)) { section = "actions"; continue; }
    line = line.replace(/^([-*•·]|\d+[.)]|\[ ?\])\s*/, "");
    if (!line) continue;

    // Una sola línea tipo "Pendiente: ..." o "Update: ..."
    let inline = line.match(/^([^:]{2,20}):\s*(.+)$/);
    let lineSection = section;
    if (inline && ACTIONS.test(norm(inline[1]))) { lineSection = "actions"; line = inline[2]; }
    else if (inline && UPDATES.test(norm(inline[1]))) { lineSection = "updates"; line = inline[2]; }

    // ¿Empieza con "Nombre:" o "Nombre,"?
    let person = null, said = null, body = line;
    const m = line.match(/^([^:,]{2,40}?)\s*[:,]\s*(.+)$/);
    if (m) {
      const p = resolve(m[1]);
      if (p) { person = p; body = m[2]; }
      else if (/^[A-ZÁÉÍÓÚÑ][\p{L}.]*(\s+[A-ZÁÉÍÓÚÑ][\p{L}.]*){0,2}$/u.test(m[1].trim())) { said = m[1].trim(); body = m[2]; }
    }

    if (lineSection === "actions") {
      let priority = "media";
      if (/\((alta|urgente|high)\)|!alta/i.test(body)) priority = "alta";
      else if (/\((baja|low)\)|!baja/i.test(body)) priority = "baja";
      body = body.replace(/\((alta|urgente|high|media|medium|baja|low)\)|!(alta|baja)/gi, "");
      const { date, rest } = parseDate(body, today);
      const who = person ?? (said ? null : defaultPerson);
      const task = clean(rest).replace(/\s+(antes del|antes de|hasta el|para el|para|del|el|al)$/i, "");
      actions.push({ body: cap(clean(task)) + (said && !person ? ` (${said})` : ""), person_id: who?.id ?? null, owner: "lead", due_date: date, priority });
      continue;
    }

    let kind = "observación";
    if (/^\(\+\)/.test(body)) { kind = "fortaleza"; body = body.replace(/^\(\+\)\s*/, ""); }
    else if (/^\(-\)/.test(body)) { kind = "a mejorar"; body = body.replace(/^\(-\)\s*/, ""); }
    const target = person ?? (said ? null : defaultPerson);
    if (target || said) personEntry(target, said).feedback.push({ kind, category: null, body: cap(clean(body)) });
    else general.push(cap(clean(body)));
  }

  const people_ = [...byPerson.values()];
  const summaryParts = [
    ...general,
    ...people_.map((p) => {
      const txt = p.feedback.map((f) => f.body.replace(/\.$/, "")).join("; ");
      return `${p.name.split(" ")[0]}: ${txt}${/[.!?]$/.test(txt) ? "" : "."}`;
    }),
  ];
  return {
    summary: summaryParts.join(" ").trim(),
    topics: [],
    people: people_,
    actions,
    suggestion_updates: [],
    next_meeting_topics: actions.map((a) => a.body).slice(0, 5),
    risks: [],
    source: "manual",
  };
}

export const TEMPLATE_ONE = `Updates
- Va mejor con los tiempos de respuesta.
- (-) Todavía duda antes de preguntar; le cuesta buscar por su cuenta.
- (+) Buen trabajo con los casos de esta semana.

Pendientes
- Revisar la guía de SS antes del 30/10
- Traer 2 opciones cada vez que tenga una duda (alta)`;

export const TEMPLATE_GROUP = `Updates
Ana: (+) más tranquila al hablar, buen avance.
Marco: (-) sigue implementando scripts sin validar.
Sofía: todo bien.

Pendientes
Marco: validar el script con el lead antes del 28/10 (alta)
Ana: practicar feedback SBI con un compañero
Revisar la carga del equipo la próxima semana (baja)`;

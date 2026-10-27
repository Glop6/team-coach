// =====================================================================
//  TEAM COACH · Edge Function "bamboo-sync"
//  Trae de BambooHR (solo lectura) las horas, goals, training y vacaciones de la gente
//  que está debajo de Gus en Bamboo, las evalúa con las mismas reglas que Bamboo Check
//  y las guarda en las tablas bamboo_* (cada líder ve solo su cadena, por RLS).
//
//  Quién puede llamarla:
//    · Gus (admin) desde el botón "Actualizar desde Bamboo" de la app.
//    · La actualización automática (pg_cron) con el header x-cron-secret.
//  Al publicarla: desactiva "Verify JWT" (la función valida la sesión por su cuenta).
//
//  Secretos (Edge Functions → Secrets):
//    BAMBOO_API_KEY      (obligatorio) la API key de Bamboo
//    BAMBOO_SUBDOMAIN    (opcional, por defecto coderoad)
//    ANTHROPIC_API_KEY   (opcional) para interpretar comentarios de horas (ya existe por "coach")
//    BAMBOO_AI_MODEL     (opcional, por defecto claude-haiku-5-5)
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
export const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CLAVES_DIA = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
export const TOLERANCIA = 0.01;
const PROBLEMA = ["falta", "parcial"];
const LABORABLES_DEFAULT = [0, 1, 2, 3, 4];

export function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

const ALIAS_PAISES: Record<string, string> = {
  "usa": "united states", "us": "united states", "u.s.": "united states",
  "united states of america": "united states", "estados unidos": "united states", "eeuu": "united states",
  "republica dominicana": "dominican republic", "do": "dominican republic",
  "brasil": "brazil", "br": "brazil", "bo": "bolivia", "ec": "ecuador", "pe": "peru",
  "gt": "guatemala", "ni": "nicaragua", "hn": "honduras", "mx": "mexico", "co": "colombia",
  "sv": "el salvador", "ar": "argentina", "cr": "costa rica", "pr": "puerto rico",
  "cl": "chile", "uy": "uruguay",
};
export const canonPais = (v: unknown) => { const n = norm(v); return ALIAS_PAISES[n] ?? n; };
export const titulo = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
export const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function fmtH(h: number): string {
  const v = r2(h);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

// Fechas como texto "YYYY-MM-DD"; los cálculos se hacen en UTC para no depender de la zona del servidor.
export const toDate = (iso: string) => new Date(iso + "T00:00:00Z");
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * 86400000));
export const weekday = (s: string) => (toDate(s).getUTCDay() + 6) % 7;        // 0 = lunes
export const fechaMini = (s: string) => `${Number(s.slice(8, 10))} ${MESES[Number(s.slice(5, 7)) - 1].slice(0, 3)}`;
export const lunesDe = (s: string) => addDays(s, -weekday(s));

/** Momento (hora local "ingenua", en ms) en que vence el día: lunes siguiente a las horaLimite. */
export const limiteDe = (s: string, horaLimite = 8) => toDate(addDays(lunesDe(s), 7)).getTime() + horaLimite * 3600000;

export function rangoDiasTxt(dias: number[]): string {
  const set = new Set(dias);
  for (let ini = 0; ini < 7; ini++) {
    const orden = Array.from({ length: dias.length }, (_, i) => (ini + i) % 7);
    if (orden.every((d) => set.has(d)) && orden.length === set.size) return `${CLAVES_DIA[orden[0]]} a ${CLAVES_DIA[orden[orden.length - 1]]}`;
  }
  return [...set].sort().map((d) => CLAVES_DIA[d]).join(", ");
}

function _fecha(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s !== "0000-00-00" && !isNaN(toDate(s).getTime()) ? s : null;
}
const _num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

export function _lista(data: any): any[] {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const k of ["goals", "records", "trainings", "data"]) if (Array.isArray(data[k])) return data[k].filter((v: any) => v && typeof v === "object");
    return Object.entries(data).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v)).map(([k, v]: any) => ({ _key: k, ...v }));
  }
  return (Array.isArray(data) ? data : []).filter((v) => v && typeof v === "object");
}

// ---------------------------------------------------------------------
// Reglas (las mismas de Bamboo Check)
// ---------------------------------------------------------------------
export type Feriados = Record<string, Record<string, [string, number]>>;
export type Rules = {
  feriados: Feriados;
  excluidos: Set<string>;
  horarios: Record<string, number[]>;     // norm(nombre) -> días (0 = lunes)
  principales: string[];
  horasDia: number;
  horaLimite: number;
  tz: number;                             // horas respecto de UTC (-4 = Bolivia)
  // Feriados regionales (Bolivia: La Paz / Cochabamba / Santa Cruz) y cambios por persona (Reglas)
  regionales?: Record<string, Record<string, [string, number, string]>>;   // país -> fecha -> [nombre, fracción, región]
  regionDefault?: Record<string, string>;                                  // país -> región por defecto
  elecciones?: Map<string, { region: string; por: string | null; cuando: string | null }>;
  movidas?: Map<string, { original: string; nuevo: string; nota: string | null; por: string | null; cuando: string | null }[]>;
  incidentsFrom?: string | null;          // primera semana (lunes) desde la que se crean incidencias automáticas
};

/** Incidencias automáticas: la semana anterior, una vez vencida (lunes 8:00), por persona con algo que no cuadra. */
export function incidenciasSemana(ev: Map<string, { dias: Dia[] }>, rules: Rules, ahora: number) {
  const hoy = iso(new Date(ahora));
  const lunes = addDays(lunesDe(hoy), -7);
  if (ahora < limiteDe(lunes, rules.horaLimite)) return null;                  // todavía no venció
  if (rules.incidentsFrom && lunes < rules.incidentsFrom) return null;          // no se generan hacia atrás
  const fin = addDays(lunes, 6);
  const filas: { eid: string; detalle: string; dias: number }[] = [];
  for (const [eid, v] of ev) {
    const malos = v.dias.filter((x) => x.fecha >= lunes && x.fecha <= fin &&
      (PROBLEMA.includes(x.estado) || (["extra", "exceso"].includes(x.estado) && !x.nota && !x.ia)));
    if (!malos.length) continue;
    const detalle = malos.map((x) => {
      const d = `${DIAS[weekday(x.fecha)]} ${fechaMini(x.fecha)}`;
      if (x.estado === "falta") return `${d}: sin registro`;
      if (x.estado === "parcial") return `${d}: ${fmtH(x.reg)} de ${fmtH(x.esperado)}h`;
      if (x.estado === "extra") return `${d}: ${fmtH(x.reg)}h en ${x.feriado ? "feriado" : x.pto ? "PTO" : "día libre"} sin comentario`;
      return `${d}: ${fmtH(x.reg)}h (más de ${fmtH(x.esperado)}h) sin comentario`;
    }).join("; ");
    filas.push({ eid, detalle, dias: malos.length });
  }
  return { lunes, vence: lunesDe(hoy), filas };
}

/** Feriados de UNA persona: los nacionales de su país + el regional de su ciudad, con los cambios de Reglas. */
export function feriadosPersona(rules: Rules, eid: string, pais: string | null): Feriados {
  if (!pais) return {};
  const base: Record<string, [string, number]> = { ...(rules.feriados[pais] ?? {}) };
  const reg = rules.regionales?.[pais];
  if (reg && Object.keys(reg).length) {
    const eleccion = rules.elecciones?.get(eid);
    const regiones = [...new Set(Object.values(reg).map((x) => x[2]))];
    const region = eleccion && regiones.includes(eleccion.region) ? eleccion.region : (rules.regionDefault?.[pais] ?? regiones[0]);
    for (const [f, [nombre, frac, r]] of Object.entries(reg)) {
      if (r !== region) continue;
      const quien = eleccion && eleccion.region === region && eleccion.por ? ` (ciudad elegida en Reglas por ${eleccion.por}${eleccion.cuando ? ", " + fechaMini(eleccion.cuando.slice(0, 10)) : ""})` : "";
      base[f] = [nombre + quien, frac];
    }
  }
  for (const m of rules.movidas?.get(eid) ?? []) {
    const fer = base[m.original];
    if (!fer) continue;
    delete base[m.original];
    const por = m.por ? ` en Reglas por ${m.por}${m.cuando ? ", " + fechaMini(m.cuando.slice(0, 10)) : ""}` : "";
    base[m.nuevo] = [`${fer[0]} (movido del ${fechaMini(m.original)}${por}${m.nota ? ": " + m.nota : ""})`, fer[1]];
  }
  return { [pais]: base };
}

/** Avisos en Horas cuando un feriado se eligió o movió en Reglas (para que se entienda el día libre). */
export function obsReglas(rules: Rules, eid: string, pais: string | null, ini: string, fin: string): { tipo: string; fuente: string; fechas: string[]; texto: string }[] {
  const out: { tipo: string; fuente: string; fechas: string[]; texto: string }[] = [];
  const en = (d: string) => d >= ini && d <= fin;
  for (const m of rules.movidas?.get(eid) ?? []) {
    if (!en(m.original) && !en(m.nuevo)) continue;
    out.push({ tipo: "info", fuente: "Reglas", fechas: [m.original, m.nuevo].filter(en),
      texto: `Feriado del ${fechaMini(m.original)} movido al ${fechaMini(m.nuevo)}${m.por ? ` por ${m.por}` : ""}${m.nota ? `: ${m.nota}` : ""}.` });
  }
  const reg = pais ? rules.regionales?.[pais] : undefined;
  const e = rules.elecciones?.get(eid);
  if (reg && e) {
    const dias = Object.entries(reg).filter(([f, x]) => x[2] === e.region && en(f)).map(([f]) => f);
    if (dias.length) out.push({ tipo: "info", fuente: "Reglas", fechas: dias, texto: `Feriado regional de ${e.region}${e.por ? ` (elegido por ${e.por})` : ""}.` });
  }
  return out;
}

export function activo(e: any, hoy: string): boolean {
  if (norm(e.status) === "inactive" || norm(e.employmentHistoryStatus).includes("terminat")) return false;
  const salida = String(e.terminationDate ?? "").slice(0, 10);
  if (salida && salida !== "0000-00-00") {
    const f = _fecha(salida);
    return f ? f >= hoy : true;
  }
  return true;
}

export function esPrincipal(proyecto: string, principales: string[]): boolean {
  if (!proyecto) return true;
  const p = norm(proyecto);
  return principales.some((x) => {
    const n = norm(x);
    if (!n) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(p);
  });
}

export function proyectoDe(e: any): string {
  const info = e.projectInfo;
  const pr = info && typeof info === "object" ? info.project : null;
  if (pr && typeof pr === "object") return String(pr.name ?? "").trim();
  return String(e.projectName ?? "").trim();
}

export type Horas = { horas: Map<string, number>; notas: Map<string, string[]>; adic: Map<string, Record<string, number>> };

/** Suma las horas del proyecto principal por persona y día; lo demás va como proyectos adicionales. */
export function procesarHoras(entradas: any[], principales: string[]): Horas {
  const horas = new Map<string, number>(), notas = new Map<string, string[]>(), adic = new Map<string, Record<string, number>>();
  for (const e of entradas ?? []) {
    let h = e.hours;
    if ((h === null || h === undefined) && e.start && e.end) {
      const a = Date.parse(e.start), b = Date.parse(e.end);
      h = Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 3600000 : 0;
    }
    const k = `${e.employeeId}|${e.date}`;
    const proyecto = proyectoDe(e);
    let nota = String(e.note ?? e.notes ?? "").trim();
    if (esPrincipal(proyecto, principales)) {
      horas.set(k, (horas.get(k) ?? 0) + _num(h));
    } else {
      const m = adic.get(k) ?? {};
      m[proyecto] = (m[proyecto] ?? 0) + _num(h);
      adic.set(k, m);
      nota = nota ? `[${proyecto}] ${nota}` : "";
    }
    if (nota) {
      const l = notas.get(k) ?? [];
      if (!l.includes(nota)) l.push(nota);
      notas.set(k, l);
    }
  }
  for (const [k, v] of adic) if (Object.values(v).reduce((a, b) => a + b, 0) <= 0) adic.delete(k);
  return { horas, notas, adic };
}

/** PTO aprobado: {eid|fecha: [horas, tipo]} */
export function tiempoLibre(reqs: any[], horasDia: number): Map<string, [number, string]> {
  const libre = new Map<string, [number, string]>();
  for (const r of reqs ?? []) {
    const unidad = r.amount?.unit ?? "days";
    const tipo = r.type?.name ?? "Time off";
    for (const [fecha, cant] of Object.entries(r.dates ?? {})) {
      const c = _num(cant);
      const h = unidad === "hours" ? c : c * horasDia;
      const k = `${r.employeeId}|${fecha}`;
      libre.set(k, [(libre.get(k)?.[0] ?? 0) + h, tipo]);
    }
  }
  return libre;
}

export function paisDe(emp: any, feriados: Feriados): string | null {
  for (const v of [emp.country, emp.location]) {
    const c = canonPais(v);
    if (!c) continue;
    if (feriados[c]) return c;
    for (const p of Object.keys(feriados)) if (p.includes(c) || c.includes(p)) return p;
  }
  return canonPais(emp.country) || null;
}

export type Dia = {
  fecha: string; reg: number; esperado: number; estado: string; etiqueta: string; motivo: string; nota: string;
  feriado: string | null; pto: string | null; ia: string; descanso: boolean; adic: Record<string, number>;
};

export function evaluarDia(eid: string, pais: string | null, f: string, h: Horas, libre: Map<string, [number, string]>,
  feriados: Feriados, ahora: number, laborables: number[], horasDia = 8, horaLimite = 8): Dia {
  const k = `${eid}|${f}`;
  const nota = (h.notas.get(k) ?? []).join(" | ");
  const adic = h.adic.get(k) ?? {};
  if (!laborables.includes(weekday(f))) {
    const reg = r2(h.horas.get(k) ?? 0);
    return { fecha: f, reg, esperado: 0, estado: reg > TOLERANCIA ? "extra" : "descanso", etiqueta: "",
      motivo: "Día no laborable según su horario", nota, feriado: null, pto: null, ia: "", descanso: true, adic };
  }
  let esperado = horasDia, etiqueta = "", feriado: string | null = null, pto: string | null = null;
  const motivos: string[] = [];
  const fer = pais ? feriados[pais]?.[f] : undefined;
  if (fer) {
    const [nombre, frac] = fer;
    esperado -= horasDia * frac;
    feriado = nombre;
    motivos.push(`Feriado ${titulo(pais!)}: ${nombre}` + (frac < 1 ? " (medio día)" : ""));
    etiqueta = frac >= 1 ? "Feriado" : "½ Feriado";
  }
  const l = libre.get(k);
  if (l) {
    const [hLibre, tipo] = l;
    esperado -= hLibre;
    pto = tipo;
    motivos.push(`${tipo} aprobado` + (hLibre < horasDia ? ` (${fmtH(hLibre)}h)` : ""));
    etiqueta = etiqueta || (hLibre >= horasDia ? "PTO" : "½ PTO");
  }
  esperado = Math.max(esperado, 0);
  const reg = r2(h.horas.get(k) ?? 0);
  const cerrado = ahora >= limiteDe(f, horaLimite);
  let estado: string;
  if (reg + TOLERANCIA >= esperado) {
    if (esperado === 0 && reg === 0) estado = "esperado";
    else if (motivos.length && reg > esperado + TOLERANCIA) estado = "extra";
    else if (reg > esperado + TOLERANCIA) estado = "exceso";
    else estado = "ok";
  } else if (!cerrado) estado = "en_plazo";
  else estado = reg === 0 ? "falta" : "parcial";
  return { fecha: f, reg, esperado, estado, etiqueta, motivo: motivos.join(" · "), nota, feriado, pto, ia: "", descanso: false, adic };
}

// ---------------------------------------------------------------------
// Comentarios con IA (sin nombres: P1, P2...)
// ---------------------------------------------------------------------
export const PROMPT_IA = `Eres un asistente de RRHH que revisa registros de horas (timesheets) de BambooHR.
La jornada normal es de 8 horas, de lunes a viernes. Por cada persona recibes solo los días relevantes del período:
feriados de su país, PTO aprobado, días con horas faltantes ("falta" o "parcial"), días con horas registradas en
feriado o PTO ("extra") y días con comentario.

Tu tarea es interpretar los comentarios y decidir si explican las diferencias.
Reglas:
- Comentarios que solo describen trabajo normal (ej. "daily", "soporte proyecto X") no son relevantes: estado "ok" y observacion vacía.
- Si la persona trabajó en su feriado y el comentario indica que lo movió a otro día (por ejemplo, a pedido del cliente),
  y ese otro día está en "falta", "parcial" o "en_plazo" dentro del período, incluye ese día en dias_justificados y
  explica el cambio. El comentario puede estar en cualquiera de los dos días.
- Justifica un día solo si un comentario lo explica de forma clara y coherente con los datos. Si hay duda, usa estado
  "revisar" y di qué falta (ej. "dice que movió el feriado pero no indica a qué día").
- Nunca justifiques un día sin un comentario relacionado. Solo puedes justificar días con estado "falta", "parcial"
  o "en_plazo" (días de la semana en curso que todavía no vencen pero ya tienen menos horas de lo esperado).
- observacion: una frase corta en español (máximo 160 caracteres), con fechas como "1 oct".
  Ejemplo: "Cambió el feriado del 1 oct al 20 oct a pedido del cliente; ambos días cuadran."

Responde SOLO con JSON válido, sin texto adicional:
{"personas":[{"id":"P1","estado":"ok|justificado|revisar","observacion":"...","dias_justificados":["YYYY-MM-DD"]}]}`;

export function payloadPersona(pais: string | null, dias: Dia[], laborables: number[]) {
  const rel = dias.filter((x) => x.nota || x.etiqueta || ["falta", "parcial", "extra", "exceso", "en_plazo"].includes(x.estado))
    .map((x) => ({ fecha: x.fecha, dia: DIAS[weekday(x.fecha)], esperado: x.esperado, registrado: x.reg, estado: x.estado,
      feriado: x.feriado, pto: x.pto, comentario: x.nota || null,
      proyectos_adicionales: Object.keys(x.adic).length ? x.adic : null }));
  const out: any = { pais: pais ? titulo(pais) : "desconocido", dias: rel };
  if (laborables.join() !== LABORABLES_DEFAULT.join()) out.dias_laborables = rangoDiasTxt(laborables);
  return out;
}

export type ResIA = { estado: string; observacion: string; dias_justificados: string[] };

export function limpiarIA(item: any): ResIA {
  return {
    estado: ["ok", "justificado", "revisar"].includes(item?.estado) ? item.estado : "revisar",
    observacion: String(item?.observacion ?? "").trim().slice(0, 220),
    dias_justificados: (item?.dias_justificados ?? []).map(String),
  };
}

/** Marca como justificados solo días con problema que la IA justificó. Devuelve las fechas afectadas. */
export function aplicarIA(dias: Dia[], res: ResIA): string[] {
  const validos = new Map(dias.filter((x) => PROBLEMA.includes(x.estado) || (x.estado === "en_plazo" && x.reg < x.esperado)).map((x) => [x.fecha, x]));
  const afectados: string[] = [];
  for (const f of res.dias_justificados ?? []) {
    const x = validos.get(f);
    if (x) { x.estado = "justificado"; x.ia = res.observacion; afectados.push(f); }
  }
  if (afectados.length && res.estado === "justificado") {
    const dist = (x: Dia) => Math.min(...afectados.map((f) => Math.abs((toDate(x.fecha).getTime() - toDate(f).getTime()) / 86400000)));
    const extras = dias.filter((x) => x.estado === "extra" && (x.nota || x.feriado))
      .sort((a, b) => (Number(!a.nota) - Number(!b.nota)) || (dist(a) - dist(b)));
    for (const x of extras.slice(0, afectados.length)) { x.estado = "ok"; x.ia = res.observacion; }
  }
  return afectados;
}

export type Obs = { tipo: string; fuente: string; fechas: string[]; texto: string };

export function observaciones(pais: string | null, dias: Dia[], resIA: ResIA | null, horasDia = 8, hayFeriados = true): Obs[] {
  const obs: Obs[] = [];
  const conNota = dias.filter((x) => x.nota).map((x) => x.fecha);
  if (resIA && resIA.observacion && resIA.estado !== "ok") {
    const just = dias.filter((x) => x.estado === "justificado").map((x) => x.fecha);
    const tipo = resIA.estado === "justificado" && just.length ? "justificado" : "revisar";
    const fechas = [...new Set([...just, ...conNota, ...dias.filter((x) => x.estado === "extra").map((x) => x.fecha)])].sort();
    obs.push({ tipo, fuente: "IA", fechas, texto: resIA.observacion });
  }
  const cubiertas = new Set(obs.flatMap((o) => o.fechas));
  for (const x of dias) {
    if (x.estado === "extra" && !cubiertas.has(x.fecha)) {
      let texto: string;
      if (x.esperado > 0) {
        texto = `Registró ${fmtH(x.reg)}h el ${fechaMini(x.fecha)}; se esperaban ${fmtH(x.esperado)}h (${x.motivo}).`;
      } else {
        texto = `Registró ${fmtH(x.reg)}h el ${fechaMini(x.fecha)}, que era ` +
          (x.feriado ? `feriado (${x.feriado})` : (x.pto ? "PTO" : "día no laborable según su horario")) + ". ";
        const cand = dias.filter((y) => y.reg === 0 && y.esperado > 0 && y.nota && ["falta", "en_plazo"].includes(y.estado));
        if (x.feriado && cand.length) {
          const y = cand[0];
          texto += `Posible cambio de feriado al ${fechaMini(y.fecha)} (0h con comentario: “${y.nota.slice(0, 80)}”). Valídalo o activa el análisis con IA.`;
        } else texto += "Si cambió de día, debería haber otro día en 0 con comentario.";
      }
      obs.push({ tipo: "revisar", fuente: "Sistema", fechas: [x.fecha], texto });
    } else if (!resIA && x.nota && PROBLEMA.includes(x.estado)) {
      obs.push({ tipo: "info", fuente: "Comentario", fechas: [x.fecha], texto: `Comentario del ${fechaMini(x.fecha)}: “${x.nota.slice(0, 150)}”` });
    }
  }
  const semanas = new Map<string, Dia[]>();
  for (const x of dias) if (x.estado === "exceso") {
    const l = lunesDe(x.fecha);
    semanas.set(l, [...(semanas.get(l) ?? []), x]);
  }
  for (const [, xs] of [...semanas.entries()].sort()) {
    const detalle = xs.map((x) => `${fechaMini(x.fecha)} (${fmtH(x.reg)}h)`).join(", ");
    const total = xs.reduce((a, x) => a + x.reg - x.esperado, 0);
    obs.push({ tipo: "revisar", fuente: "Sistema", fechas: xs.map((x) => x.fecha),
      texto: `Más horas de lo esperado (${fmtH(horasDia)}h/día): ${detalle}. Total +${fmtH(total)}h en proyecto principal.` });
  }
  if (!pais) obs.push({ tipo: "info", fuente: "Sistema", fechas: [], texto: "País no detectado en BambooHR: no se aplicaron feriados." });
  else if (!hayFeriados) obs.push({ tipo: "info", fuente: "Sistema", fechas: [], texto: `No hay feriados de ${titulo(pais)} cargados en Reglas: no se aplicaron feriados.` });
  return obs;
}

// ---------------------------------------------------------------------
// Desarrollo y vacaciones
// ---------------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s"'<>]+/g;

export function normalizarGoal(g: any, hoy: string) {
  const pct = Math.max(0, Math.min(_num(g.percentComplete), 100));
  const st = norm(g.status);
  const estado = st.includes("complet") || _num(g.percentComplete) >= 100 ? "completado" : (st.includes("clos") || st.includes("cerrad")) ? "cerrado" : "en_progreso";
  const vence = _fecha(g.dueDate);
  const vencido = estado === "en_progreso" && vence !== null && vence < hoy;
  const dias = vence ? (toDate(vence).getTime() - toDate(hoy).getTime()) / 86400000 : 99;
  const proximo = estado === "en_progreso" && !vencido && vence !== null && dias <= 14 && pct < 80;
  return { id: String(g.id ?? g._key ?? ""), titulo: String(g.title ?? "Goal sin título").trim() || "Goal sin título", pct, vence,
    completado: _fecha(g.completionDate), estado, vencido, proximo };
}

export function normalizarTraining(r: any, tipos: Record<string, any>) {
  const tipo = r.type;
  const tid = String(tipo && typeof tipo === "object" ? tipo.id : tipo);
  const t = tipos[tid] ?? (tipo && typeof tipo === "object" ? tipo : {});
  const nombre = (t?.name) || r.name || r.title || "Training";
  const textos = Object.values(r).filter((v) => typeof v === "string") as string[];
  const links = [...new Set(textos.flatMap((s) => s.match(URL_RE) ?? []).map((u) => u.replace(/[.,);]+$/, "")))].sort();
  const notas = String(r.notes ?? "").trim();
  return { id: String(r.id ?? r._key ?? ""), fecha: _fecha(r.completed ?? r.completedDate ?? r.date), horas: _num(r.hours),
    nombre: String(nombre).trim(), notas: notas.replace(URL_RE, "").trim(), links };
}

export function elegirSaldo(filas: any[], horasDia = 8) {
  if (!filas.length) return null;
  const puntaje = (f: any): [number, number] => {
    const n = norm(f.name);
    const pr = n.includes("contractor") ? 3 : (n.includes("pto") || n.includes("vacac") || n.includes("vacation") || n.includes("time off")) ? 2 : 0;
    return [pr, _num(f.balance) + _num(f.usedYearToDate)];
  };
  const f = filas.reduce((a, b) => { const pa = puntaje(a), pb = puntaje(b); return (pb[0] > pa[0] || (pb[0] === pa[0] && pb[1] > pa[1])) ? b : a; });
  const factor = norm(f.units).startsWith("hour") ? 1 / horasDia : 1;
  return { tipo: f.name || "Time off", disponible: _num(f.balance) * factor, usado: _num(f.usedYearToDate) * factor };
}

/** Días de time off aprobados a futuro (de mañana a fin de año): {eid: {tipo_normalizado: días}} */
export function programados(reqs: any[], hoy: string, horasDia = 8) {
  const fin = `${hoy.slice(0, 4)}-12-31`;
  const out: Record<string, Record<string, number>> = {};
  for (const r of reqs ?? []) {
    const unidad = r.amount?.unit ?? "days";
    const tipo = norm(r.type?.name ?? "");
    for (const [fecha, cant] of Object.entries(r.dates ?? {})) {
      const f = _fecha(fecha);
      if (f && hoy < f && f <= fin) {
        const e = (out[String(r.employeeId)] ??= {});
        e[tipo] = (e[tipo] ?? 0) + (unidad === "hours" ? _num(cant) / horasDia : _num(cant));
      }
    }
  }
  return out;
}

export function evaluarVacaciones(s: { tipo: string; disponible: number; usado: number }, prog: Record<string, number>, hoy: string) {
  const total = s.disponible + s.usado;
  const planificado = Object.entries(prog).filter(([k]) => !k || k === norm(s.tipo) || k.includes("contractor") || k.includes("pto") || k.includes("vacac") || k.includes("time off"))
    .reduce((a, [, v]) => a + v, 0);
  const sinPlan = Math.max(s.disponible - planificado, 0);
  const y = Number(hoy.slice(0, 4));
  const diasAnio = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000;
  const transcurrido = ((toDate(hoy).getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / diasAnio;
  const ideal = total * (1 - transcurrido);
  const exceso = r2(sinPlan - ideal);
  const nivel = hoy.slice(5, 7) === "12"
    ? (r2(sinPlan) > 3 ? "low" : r2(sinPlan) > 1 ? "mid" : "")
    : (exceso > 3 ? "low" : exceso > 1 ? "mid" : "");
  return { ...s, total, programado: planificado, sin_plan: sinPlan, ideal, exceso, transcurrido, nivel };
}

// ---------------------------------------------------------------------
// Alcance: Gus y toda la gente que tiene debajo en Bamboo
// ---------------------------------------------------------------------
export function alcance(empleados: any[], yo: string, rules: Rules, hoy: string) {
  const todos = new Map<string, any>();
  for (const e of empleados) if (activo(e, hoy) && !rules.excluidos.has(norm(e.displayName))) todos.set(String(e.id), e);
  const hijos = new Map<string, any[]>();
  for (const e of todos.values()) {
    const sup = String(e.supervisorEId ?? "");
    if (sup && sup !== String(e.id)) hijos.set(sup, [...(hijos.get(sup) ?? []), e]);
  }
  const equipo = new Map<string, any>();
  const pila = [yo];
  const vistos = new Set([yo]);
  while (pila.length) {
    const id = pila.pop()!;
    for (const h of hijos.get(id) ?? []) {
      const hid = String(h.id);
      if (vistos.has(hid)) continue;
      vistos.add(hid);
      equipo.set(hid, h);
      pila.push(hid);
    }
  }
  return { equipo, yoEmp: todos.get(yo) ?? empleados.find((e) => String(e.id) === yo) ?? null };
}

/** Días a revisar: desde el 1 del mes anterior hasta el fin del mes en curso (hora local).
 *  Los días que todavía no vencen quedan "en plazo"; así se puede verificar el mes completo
 *  cuando la gente registra por adelantado (por ejemplo, el 23 o 25 de cada mes). */
export function rango(hoy: string) {
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7));
  const ini = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  const finMes = iso(new Date(Date.UTC(y, m, 0)));
  const fin = finMes > addDays(hoy, -1) ? finMes : addDays(hoy, -1);
  const dias: string[] = [];
  for (let d = ini; d <= fin; d = addDays(d, 1)) dias.push(d);
  return { ini, fin, dias };
}

/** Evalúa a todo el equipo en el rango. No llama a nadie: recibe lo que trajo Bamboo. */
export function evaluarEquipo(equipo: Map<string, any>, entradas: any[], reqs: any[], rules: Rules, dias: string[], ahora: number) {
  const h = procesarHoras(entradas, rules.principales);
  const libre = tiempoLibre(reqs, rules.horasDia);
  const out = new Map<string, { pais: string | null; info: string; laborables: number[]; dias: Dia[] }>();
  for (const [eid, e] of equipo) {
    const lab = rules.horarios[norm(e.displayName)] ?? LABORABLES_DEFAULT;
    const pais = paisDe(e, rules.feriados);
    const info = (pais ? titulo(pais) : "País no detectado") + (lab.join() !== LABORABLES_DEFAULT.join() ? ` · Horario ${rangoDiasTxt(lab)}` : "");
    const ds: Dia[] = [];
    const fer = feriadosPersona(rules, eid, pais);
    for (const d of dias) {
      const x = evaluarDia(eid, pais, d, h, libre, fer, ahora, lab, rules.horasDia, rules.horaLimite);
      if (x.estado !== "descanso") ds.push(x);                // los días de descanso sin horas no se guardan
    }
    out.set(eid, { pais, info, laborables: lab, dias: ds });
  }
  return out;
}

// ---------------------------------------------------------------------
// Enlace persona de Team Coach ↔ Bamboo
// ---------------------------------------------------------------------
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 1);

export function enlazar(personas: any[], bamboo: { id: string; nombre: string; email: string | null }[]) {
  const porId = new Map(bamboo.map((b) => [b.id, b]));
  const usados = new Set<string>();
  const enlaces = new Map<string, { bid: string; como: string }>();   // person_id -> bamboo
  const activas = personas.filter((p) => !["salió", "inactivo"].includes(p.status));
  // 1) los que ya estaban enlazados (a mano o en una corrida anterior)
  for (const p of personas) if (p.bamboo_id && porId.has(p.bamboo_id) && !usados.has(p.bamboo_id)) {
    enlaces.set(p.id, { bid: p.bamboo_id, como: "previo" }); usados.add(p.bamboo_id);
  }
  const libres = () => bamboo.filter((b) => !usados.has(b.id));
  const tomar = (p: any, b: any, como: string) => { enlaces.set(p.id, { bid: b.id, como }); usados.add(b.id); };
  // 2) por correo, 3) por nombre exacto, 4) por parecido (todas las palabras del nombre de Team Coach están en Bamboo)
  for (const p of activas) if (!enlaces.has(p.id) && p.email) {
    const b = libres().find((b) => b.email && norm(b.email) === norm(p.email));
    if (b) tomar(p, b, "correo");
  }
  for (const p of activas) if (!enlaces.has(p.id)) {
    const b = libres().find((b) => norm(b.nombre) === norm(p.full_name));
    if (b) tomar(p, b, "nombre");
  }
  for (const p of activas) if (!enlaces.has(p.id)) {
    const tp = tokens(p.full_name);
    if (tp.length < 2) continue;
    // Una lista de palabras contiene a la otra (ej. "Ana Soto" ↔ "Ana Soto Ruiz", o al revés)
    const cands = libres().filter((b) => {
      const tb = tokens(b.nombre);
      if (tb.length < 2) return false;
      const sb = new Set(tb), sp = new Set(tp);
      return tp.every((t) => sb.has(t)) || tb.every((t) => sp.has(t));
    });
    if (cands.length === 1) tomar(p, cands[0], "parecido");
  }
  const enlazados = new Set([...enlaces.values()].map((v) => v.bid));
  const reporte = {
    parecido: [...enlaces.entries()].filter(([, v]) => v.como === "parecido")
      .map(([pid, v]) => ({ person: personas.find((p) => p.id === pid)?.full_name, bamboo: porId.get(v.bid)?.nombre })),
    correo_distinto: [...enlaces.entries()].map(([pid, v]) => ({ p: personas.find((x) => x.id === pid), b: porId.get(v.bid) }))
      .filter(({ p, b }) => p?.email && b?.email && norm(p.email) !== norm(b.email))
      .map(({ p, b }) => ({ person: p.full_name, team_coach: p.email, bamboo: b!.email })),
    sin_bamboo: activas.filter((p) => !enlaces.has(p.id)).map((p) => p.full_name).sort(),
    lideres_sin_bamboo: activas.filter((p) => p.is_lead && !enlaces.has(p.id)).map((p) => p.full_name).sort(),
    solo_en_bamboo: bamboo.filter((b) => !enlazados.has(b.id)).map((b) => b.nombre).sort(),
  };
  return { enlaces, reporte };
}

// ---------------------------------------------------------------------
// Bamboo y Claude (red)
// ---------------------------------------------------------------------
export function bambooClient(key: string, subdominio: string, fetcher: typeof fetch = fetch) {
  const base = `https://api.bamboohr.com/api/gateway.php/${subdominio}/v1`;
  const auth = "Basic " + btoa(`${key}:x`);
  return async (metodo: string, ruta: string, cuerpo?: unknown) => {
    for (let intento = 0; ; intento++) {
      const r = await fetcher(base + ruta, {
        method: metodo,
        headers: { Authorization: auth, Accept: "application/json", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      if ((r.status === 429 || r.status === 503) && intento < 3) { await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1))); continue; }
      const txt = await r.text();
      if (r.status >= 400) throw new Error(`HTTP ${r.status} en ${ruta.split("?")[0]}: ${txt.slice(0, 160)}`);
      return txt.trim() ? JSON.parse(txt) : null;
    }
  };
}
type Api = ReturnType<typeof bambooClient>;

export async function enParalelo<T>(ids: string[], fn: (id: string) => Promise<T>, workers = 8) {
  const out = new Map<string, T | Error>();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(workers, ids.length) }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try { out.set(id, await fn(id)); } catch (e) { out.set(id, e instanceof Error ? e : new Error(String(e))); }
    }
  }));
  return out;
}

async function empleados(api: Api) {
  const campos = ["id", "displayName", "workEmail", "supervisorEId", "country", "location", "status", "employmentHistoryStatus", "terminationDate"];
  try {
    const data = await api("POST", "/reports/custom?format=JSON&onlyCurrent=true", { title: "team-coach", fields: campos });
    const lista = data?.employees ?? [];
    if (lista.length && "supervisorEId" in lista[0]) return lista;
  } catch { /* uso el directorio */ }
  const dir = (await api("GET", "/employees/directory"))?.employees ?? [];
  const res = await enParalelo(dir.map((e: any) => String(e.id)), async (id) => ({ ...(await api("GET", `/employees/${id}?fields=${campos.slice(1).join(",")}`)), id }));
  return [...res.values()].filter((v) => !(v instanceof Error));
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function llamarClaude(key: string, model: string, contenido: string, fetcher: typeof fetch = fetch) {
  const r = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 4000, system: PROMPT_IA, messages: [{ role: "user", content: contenido }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${data?.error?.message ?? ""}`.slice(0, 200));
  const texto = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("La IA no devolvió JSON.");
  return JSON.parse(m[0]);
}

/** Interpreta comentarios en lotes de 12 personas (alias P1..). Usa caché para no repetir. */
export async function analizarIA(eval_: Map<string, { pais: string | null; laborables: number[]; dias: Dia[] }>,
  cache: { get: (h: string) => Promise<ResIA | null>; set: (h: string, r: ResIA) => Promise<void> },
  llamar: (contenido: string) => Promise<any>, model: string) {
  const res = new Map<string, ResIA>();
  const pendientes: [string, string, any][] = [];
  let analizados = 0;
  const errores: string[] = [];
  for (const [eid, v] of eval_) {
    if (!v.dias.some((x) => x.nota)) continue;
    analizados++;
    const p = payloadPersona(v.pais, v.dias, v.laborables);
    const h = await sha256(model + PROMPT_IA + JSON.stringify(p));
    const c = await cache.get(h);
    if (c) res.set(eid, c); else pendientes.push([eid, h, p]);
  }
  for (let i = 0; i < pendientes.length; i += 12) {
    const lote = pendientes.slice(i, i + 12);
    const alias = new Map(lote.map(([eid], j) => [`P${j + 1}`, eid]));
    const contenido = JSON.stringify({ personas: lote.map(([, , p], j) => ({ id: `P${j + 1}`, ...p })) });
    try {
      const resp = await llamar(contenido);
      for (const item of resp?.personas ?? []) {
        const eid = alias.get(String(item.id));
        if (!eid) continue;
        const limpio = limpiarIA(item);
        res.set(eid, limpio);
        await cache.set(lote.find(([e]) => e === eid)![1], limpio);
      }
    } catch (e) { errores.push(String((e as Error).message ?? e)); }
  }
  const estado = errores.length && !res.size ? `error: ${errores[0]}` : errores.length ? `parcial: ${errores[0]}` : `${analizados} personas con comentarios`;
  return { res, estado };
}

// ---------------------------------------------------------------------
// Sincronización completa
// ---------------------------------------------------------------------
export async function cargarReglas(db: any): Promise<Rules> {
  let fer = await db.from("rule_holidays").select("country,day,name,fraction,region");
  if (fer.error) fer = await db.from("rule_holidays").select("country,day,name,fraction");   // antes de 09_feriados_regionales.sql
  const [exc, hor, cfg] = await Promise.all([
    db.from("rule_excluded").select("full_name"),
    db.from("rule_schedules").select("full_name,days"),
    db.from("rule_config").select("key,value"),
  ]);
  for (const r of [fer, exc, hor, cfg]) if (r.error) throw new Error("No pude leer las reglas: " + r.error.message);
  const feriados: Feriados = {};
  const regionales: Record<string, Record<string, [string, number, string]>> = {};
  for (const f of fer.data) {
    if (f.region) (regionales[canonPais(f.country)] ??= {})[f.day] = [f.name, Number(f.fraction), f.region];
    else (feriados[canonPais(f.country)] ??= {})[f.day] = [f.name, Number(f.fraction)];
  }
  const c = Object.fromEntries(cfg.data.map((r: any) => [r.key, r.value]));
  // Cambios por persona (si todavía no existen las tablas, se ignoran)
  const [ch, mv] = await Promise.all([
    db.from("holiday_choices").select("bamboo_id,region,changed_by_name,changed_at"),
    db.from("holiday_moves").select("bamboo_id,original_day,new_day,note,changed_by_name,changed_at"),
  ]);
  const elecciones = new Map<string, { region: string; por: string | null; cuando: string | null }>();
  for (const r of (ch.error ? [] : ch.data ?? [])) elecciones.set(String(r.bamboo_id), { region: r.region, por: r.changed_by_name ?? null, cuando: r.changed_at ?? null });
  const movidas = new Map<string, { original: string; nuevo: string; nota: string | null; por: string | null; cuando: string | null }[]>();
  for (const r of (mv.error ? [] : mv.data ?? [])) {
    const k = String(r.bamboo_id);
    movidas.set(k, [...(movidas.get(k) ?? []), { original: r.original_day, nuevo: r.new_day, nota: r.note ?? null, por: r.changed_by_name ?? null, cuando: r.changed_at ?? null }]);
  }
  const incidentsFrom = typeof c.incidents_from === "string" ? c.incidents_from : null;
  const regionDefault = Object.fromEntries(Object.entries((c.default_regions && typeof c.default_regions === "object") ? c.default_regions : {}).map(([k, v]) => [canonPais(k), String(v)]));
  return {
    feriados, regionales, regionDefault, elecciones, movidas, incidentsFrom,
    excluidos: new Set(exc.data.map((r: any) => norm(r.full_name))),
    horarios: Object.fromEntries(hor.data.map((r: any) => [norm(r.full_name), r.days])),
    principales: Array.isArray(c.main_projects) && c.main_projects.length ? c.main_projects : ["DDC"],
    horasDia: Number(c.hours_per_day ?? 8) || 8,
    horaLimite: Number(c.deadline_hour ?? 8),
    tz: Number(c.timezone_offset ?? -4),
  };
}

async function porLotes(rows: any[], n: number, fn: (lote: any[]) => Promise<{ error: any }>) {
  for (let i = 0; i < rows.length; i += n) {
    const { error } = await fn(rows.slice(i, i + n));
    if (error) throw new Error(error.message);
  }
}

export async function sincronizar(db: any, api: Api, opts: { aiKey?: string; aiModel?: string; ahoraMs?: number; fetcher?: typeof fetch } = {}) {
  const t0 = Date.now();
  const rules = await cargarReglas(db);
  const ahora = (opts.ahoraMs ?? Date.now()) + rules.tz * 3600000;         // hora local "ingenua"
  const hoy = iso(new Date(ahora));
  const avisos: string[] = [];

  const yo = String((await api("GET", "/employees/0?fields=id,displayName"))?.id ?? "");
  if (!yo) throw new Error("Bamboo no devolvió el usuario de la API key.");
  const emps = await empleados(api);
  const { equipo, yoEmp } = alcance(emps, yo, rules, hoy);
  if (!equipo.size) throw new Error("No encontré personas a tu cargo en Bamboo (revisa que el campo Supervisor esté visible).");
  const ids = [...equipo.keys()];

  // Horas y PTO
  const { ini, fin, dias } = rango(hoy);
  const entradas: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    entradas.push(...((await api("GET", `/time_tracking/timesheet_entries?start=${ini}&end=${fin}&employeeIds=${ids.slice(i, i + 50).join(",")}`)) ?? []));
  }
  let reqs: any[] = [];
  try { reqs = (await api("GET", `/time_off/requests?start=${ini}&end=${fin}&status=approved`)) ?? []; }
  catch (e) { avisos.push(`No pude leer el PTO aprobado: ${(e as Error).message}`); }
  const ev = evaluarEquipo(equipo, entradas, reqs, rules, dias, ahora);

  // IA
  let iaEstado = "desactivada (falta ANTHROPIC_API_KEY)";
  let resIA = new Map<string, ResIA>();
  if (opts.aiKey) {
    const model = opts.aiModel ?? "claude-haiku-5-5";
    const cache = {
      get: async (h: string) => (await db.from("bamboo_ai_cache").select("result").eq("hash", h).maybeSingle()).data?.result ?? null,
      set: async (h: string, r: ResIA) => { await db.from("bamboo_ai_cache").upsert({ hash: h, result: r }); },
    };
    const r = await analizarIA(ev, cache, (c) => llamarClaude(opts.aiKey!, model, c, opts.fetcher), model);
    resIA = r.res; iaEstado = r.estado;
  }
  const obs = new Map<string, Obs[]>();
  for (const [eid, v] of ev) {
    const r = resIA.get(eid) ?? null;
    if (r) aplicarIA(v.dias, r);
    obs.set(eid, [...obsReglas(rules, eid, v.pais, ini, fin), ...observaciones(v.pais, v.dias, r, rules.horasDia, !v.pais || !!rules.feriados[v.pais])]);
  }

  // Goals, training y vacaciones
  let tipos: Record<string, any> = {};
  try { tipos = Object.fromEntries(_lista(await api("GET", "/training/type")).map((t) => [String(t.id), t])); } catch { /* sin permiso: "Training" */ }
  const goals = await enParalelo(ids, async (id) => _lista(await api("GET", `/performance/employees/${id}/goals`)).map((g) => normalizarGoal(g, hoy)));
  const trn = await enParalelo(ids, async (id) => _lista(await api("GET", `/training/record/employee/${id}`)).map((r) => normalizarTraining(r, tipos)));
  const saldos = await enParalelo(ids, async (id) => elegirSaldo(_lista(await api("GET", `/employees/${id}/time_off/calculator?end=${hoy}`)), rules.horasDia));
  let prog: Record<string, Record<string, number>> = {};
  if (hoy < `${hoy.slice(0, 4)}-12-31`) {
    try { prog = programados((await api("GET", `/time_off/requests?start=${addDays(hoy, 1)}&end=${hoy.slice(0, 4)}-12-31&status=approved`)) ?? [], hoy, rules.horasDia); }
    catch { /* sin programados */ }
  }
  const fallas = (m: Map<string, unknown>, nombre: string) => {
    const err = [...m.values()].filter((v) => v instanceof Error) as Error[];
    if (err.length === m.size && m.size) avisos.push(`${nombre}: ${/40[13]/.test(err[0].message) ? "sin permiso en BambooHR" : err[0].message}`);
    else if (err.length) avisos.push(`${nombre}: no se pudo leer a ${err.length} de ${m.size} personas`);
    return err.length;
  };
  fallas(goals, "Goals"); fallas(trn, "Training"); fallas(saldos, "Vacaciones");

  // Enlace con Team Coach
  const { data: personas, error: ep } = await db.from("people").select("id,full_name,email,status,is_lead,bamboo_id");
  if (ep) throw new Error(ep.message);
  const { enlaces, reporte } = enlazar(personas, ids.map((id) => ({ id, nombre: equipo.get(id).displayName, email: equipo.get(id).workEmail ?? null })));
  const personaDe = new Map([...enlaces.entries()].map(([pid, v]) => [v.bid, pid]));
  for (const [pid, v] of enlaces) {
    const p = personas.find((x: any) => x.id === pid);
    if (p.bamboo_id !== v.bid) {
      await db.from("people").update({ bamboo_id: null }).eq("bamboo_id", v.bid);
      const { error } = await db.from("people").update({ bamboo_id: v.bid }).eq("id", pid);
      if (error) avisos.push(`No pude enlazar a ${p.full_name}: ${error.message}`);
    }
  }

  // Guardar
  const empRows = ids.map((id) => {
    const e = equipo.get(id), v = ev.get(id)!;
    return { bamboo_id: id, full_name: e.displayName, email: e.workEmail ?? null, supervisor_id: e.supervisorEId ? String(e.supervisorEId) : null,
      country: v.pais, info: v.info, person_id: personaDe.get(id) ?? null, ai_obs: resIA.get(id) ?? null, obs: obs.get(id) ?? [], updated_at: new Date().toISOString() };
  });
  if (yoEmp) empRows.push({ bamboo_id: yo, full_name: yoEmp.displayName, email: yoEmp.workEmail ?? null, supervisor_id: null,
    country: paisDe(yoEmp, rules.feriados), info: "", person_id: personaDe.get(yo) ?? null, ai_obs: null, obs: [], updated_at: new Date().toISOString() });
  const enAlcance = empRows.map((r) => r.bamboo_id);
  await porLotes(empRows, 200, (l) => db.from("bamboo_employees").upsert(l));
  const { data: viejosEmp } = await db.from("bamboo_employees").select("bamboo_id");
  const fuera = (viejosEmp ?? []).map((r: any) => r.bamboo_id).filter((b: string) => !enAlcance.includes(b));
  if (fuera.length) await db.from("bamboo_employees").delete().in("bamboo_id", fuera);

  // Días: conserva cómo estaba un día con alerta si luego cambió ("antes")
  const previos = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 50) {
    let desde = 0;
    for (;;) {
      const { data, error } = await db.from("bamboo_days").select("bamboo_id,day,state,hours,seen,before_state")
        .in("bamboo_id", ids.slice(i, i + 50)).gte("day", ini).lte("day", fin).range(desde, desde + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) previos.set(`${r.bamboo_id}|${r.day}`, r);
      if (!data || data.length < 1000) break;
      desde += 1000;
    }
  }
  const dayRows: any[] = [];
  for (const [eid, v] of ev) for (const x of v.dias) {
    const viejo = previos.get(`${eid}|${x.fecha}`);
    let before = viejo?.before_state ?? null;
    if (!before && viejo && ["falta", "parcial", "exceso", "extra"].includes(viejo.state) && viejo.state !== x.estado) {
      before = { state: viejo.state, hours: Number(viejo.hours), seen: viejo.seen };
    }
    dayRows.push({ bamboo_id: eid, day: x.fecha, hours: x.reg, expected: x.esperado, state: x.estado, label: x.etiqueta || null,
      reason: x.motivo || null, note: x.nota || null, other_projects: Object.keys(x.adic).length ? x.adic : null, ai: x.ia || null,
      holiday: x.feriado, pto: x.pto, rest: x.descanso, before_state: before, seen: hoy });
  }
  await porLotes(dayRows, 500, (l) => db.from("bamboo_days").upsert(l));
  const nuevos = new Set(dayRows.map((r) => `${r.bamboo_id}|${r.day}`));
  const sobran = [...previos.keys()].filter((k) => !nuevos.has(k));
  for (const k of sobran) { const [b, d] = k.split("|"); await db.from("bamboo_days").delete().eq("bamboo_id", b).eq("day", d); }

  // Goals / training / vacaciones: se reemplazan para quien se pudo leer
  const okIds = (m: Map<string, unknown>) => ids.filter((id) => !(m.get(id) instanceof Error));
  const gIds = okIds(goals), tIds = okIds(trn), sIds = okIds(saldos);
  for (let i = 0; i < gIds.length; i += 100) await db.from("bamboo_goals").delete().in("bamboo_id", gIds.slice(i, i + 100));
  await porLotes(gIds.flatMap((id) => (goals.get(id) as any[]).map((g, j) => ({ bamboo_id: id, goal_id: g.id || `g${j}`, title: g.titulo, pct: g.pct, due: g.vence,
    completed: g.completado, state: g.estado, overdue: g.vencido, soon: g.proximo }))), 500, (l) => db.from("bamboo_goals").upsert(l));
  for (let i = 0; i < tIds.length; i += 100) await db.from("bamboo_training").delete().in("bamboo_id", tIds.slice(i, i + 100));
  await porLotes(tIds.flatMap((id) => (trn.get(id) as any[]).map((t, j) => ({ bamboo_id: id, record_id: t.id || `t${j}`, day: t.fecha, hours: t.horas,
    name: t.nombre, notes: t.notas || null, links: t.links }))), 500, (l) => db.from("bamboo_training").upsert(l));
  const ptoRows = sIds.filter((id) => saldos.get(id)).map((id) => {
    const v = evaluarVacaciones(saldos.get(id) as any, prog[id] ?? {}, hoy);
    return { bamboo_id: id, kind: v.tipo, available: r2(v.disponible), used: r2(v.usado), planned: r2(v.programado), total: r2(v.total),
      unplanned: r2(v.sin_plan), ideal: r2(v.ideal), elapsed: v.transcurrido, level: v.nivel, updated_at: new Date().toISOString() };
  });
  await porLotes(ptoRows, 200, (l) => db.from("bamboo_pto").upsert(l));

  // Incidencias automáticas de Bamboo (una por persona y semana; nunca se pisan ni se borran)
  let incidencias = 0;
  const inc = incidenciasSemana(ev, rules, ahora);
  if (inc?.filas.length) {
    const rows = inc.filas.map((f) => ({ bamboo_id: f.eid, person_id: personaDe.get(f.eid) ?? null, source: "bamboo",
      category: "Bamboo (registro de horas)", severity: "leve", occurred_on: inc.vence, week_start: inc.lunes,
      detail: f.detalle, created_by_name: "Bamboo (automático)" }));
    const { error } = await db.from("incidents").upsert(rows, { onConflict: "source,bamboo_id,week_start", ignoreDuplicates: true });
    if (error && !/incidents/.test(error.message)) avisos.push(`No pude registrar incidencias: ${error.message}`);
    else if (!error) incidencias = rows.length;
  }

  const sinFeriados = [...new Set([...ev.values()].map((v) => v.pais).filter((p) => p && !rules.feriados[p!]))];
  if (sinFeriados.length) avisos.push(`Países sin feriados cargados: ${sinFeriados.map((p) => titulo(p!)).join(", ")}`);
  const anios = new Set(Object.values(rules.feriados).flatMap((v) => Object.keys(v).map((f) => f.slice(0, 4))));
  const faltan = [...new Set(dias.map((d) => d.slice(0, 4)))].filter((a) => !anios.has(a));
  if (faltan.length) avisos.push(`No hay feriados cargados para ${faltan.join(", ")}.`);

  // Resumen como el de Bamboo Check: semana a revisar y mes en curso (hasta ayer)
  const lunes = weekday(hoy) >= 5 ? lunesDe(hoy) : addDays(lunesDe(hoy), -7);
  const mesRef = fin.slice(0, 7);
  const pendientesEn = (f: (d: string) => boolean) => [...ev.values()].filter((v) => v.dias.some((x) => f(x.fecha) && PROBLEMA.includes(x.estado))).length;
  const conAlertas = pendientesEn((d) => d >= lunes && d <= addDays(lunes, 6));
  const conAlertasMes = pendientesEn((d) => d.startsWith(mesRef));
  return {
    personas: ids.length, dias: dayRows.length, desde: ini, hasta: fin, semana: lunes, con_alertas: conAlertas, con_alertas_mes: conAlertasMes, ia: iaEstado,
    incidencias, avisos, enlaces: reporte, segundos: Math.round((Date.now() - t0) / 100) / 10,
  };
}

// ---------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
declare const Deno: any;
if (typeof Deno !== "undefined") Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const env = (k: string) => Deno.env.get(k);
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  let fuente = "boton";
  try {
    const secreto = req.headers.get("x-cron-secret");
    if (secreto) {
      const { data } = await admin.from("bamboo_private").select("value").eq("key", "cron_secret").maybeSingle();
      if (!data?.value || data.value !== secreto) return json({ error: "No autorizado." }, 401);
      fuente = "cron";
    } else {
      const auth = req.headers.get("Authorization") ?? "";
      const { data: { user } } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!user) return json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, 401);
      const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
      const body = await req.clone().json().catch(() => ({}));
      if (body?.source === "regla" && (me?.role === "lead" || me?.role === "admin")) {
        // Alguien cambió un feriado en Reglas: se actualiza, pero como mucho una vez cada 3 minutos
        const { data: reciente } = await admin.from("bamboo_sync_log").select("id").gte("started_at", new Date(Date.now() - 3 * 60000).toISOString()).limit(1);
        if (reciente?.length) return json({ ok: true, skipped: true, message: "Se reflejará en la próxima actualización." });
        fuente = "regla";
      } else if (me?.role !== "admin") return json({ error: "Solo Gus puede actualizar desde Bamboo." }, 403);
    }
    const key = env("BAMBOO_API_KEY");
    if (!key) return json({ error: "Falta el secreto BAMBOO_API_KEY en Supabase (Edge Functions → Secrets)." }, 500);

    // Una sola actualización a la vez
    const { data: enCurso } = await admin.from("bamboo_sync_log").select("id,started_at").is("finished_at", null)
      .gte("started_at", new Date(Date.now() - 4 * 60000).toISOString()).limit(1);
    if (enCurso?.length) return json({ error: "Ya hay una actualización en curso; espera un minuto." }, 409);

    const { data: log } = await admin.from("bamboo_sync_log").insert({ source: fuente }).select("id").single();
    try {
      const stats = await sincronizar(admin, bambooClient(key, env("BAMBOO_SUBDOMAIN") ?? "coderoad"),
        { aiKey: env("ANTHROPIC_API_KEY"), aiModel: env("BAMBOO_AI_MODEL") ?? "claude-haiku-5-5" });
      const msg = `${stats.personas} personas · semana: ${stats.con_alertas} con horas pendientes · mes: ${stats.con_alertas_mes}`;
      await admin.from("bamboo_sync_log").update({ finished_at: new Date().toISOString(), ok: true, message: msg, stats }).eq("id", log?.id);
      return json({ ok: true, message: msg, stats });
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 500);
      await admin.from("bamboo_sync_log").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", log?.id);
      return json({ error: msg }, 500);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

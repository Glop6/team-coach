// =====================================================================
//  TEAM COACH · Edge Function "coach"
//  Acciones:
//    analyze        (admin o el lead que subió la reunión) → analiza la transcripción
//    prep           (admin / lead) → prepara la próxima reunión con alguien
//    ideas          (admin)  → nuevas ideas / métodos para una persona
//    idea_solutions (todos)  → soluciones para un problema/idea del banco
//    recommend      (admin o quien subió la reunión) → recomendaciones de liderazgo
//    notify         (lead)   → avisa a Gus por correo que hay puntos por revisar
//    create_user    (admin)  → crea el login de un colaborador
//    reset_password (admin)  → cambia la contraseña de un colaborador
//  Secretos (Edge Functions → Secrets):
//    ANTHROPIC_API_KEY   (obligatorio)
//    ANTHROPIC_MODEL     (opcional, por defecto claude-sonnet-5-5)
//    RESEND_API_KEY      (para el aviso por correo)
//    NOTIFY_EMAIL        (opcional, por defecto clopezgustavo@gmail.com)
//    APP_URL             (opcional, por defecto https://gustavolopez-spec.github.io/team-coach/)
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL") ?? "clopezgustavo@gmail.com";
const APP_URL = Deno.env.get("APP_URL") ?? "https://gustavolopez-spec.github.io/team-coach/";

const KINDS = ["fortaleza", "a mejorar", "observación", "avance", "retroceso"];
const CATEGORIES =
  "comunicación, asertividad, cómo preguntar, proactividad, autonomía, actitud, soft skills, técnico, calidad, procesos, organización, inglés, liderazgo, comunicación con cliente, crecimiento, general";

const COACH_STYLE = `Eres el copiloto de coaching de Gus, Team Lead de un equipo de operaciones (CodeRoad Internal) que trabaja con WOMS, Salesforce (SFX) y PowerApps en Site Services, Landing Pages, Postings, QA, Audits y Grooming.
Gus tiene 1:1 y reuniones mensuales con sus colaboradores (leads de grupo), que a su vez gestionan a su gente.
Reglas:
- Escribe claro, objetivo y al punto, en el idioma que se te indique. Nada de relleno.
- Basa todo en lo que se dijo; no inventes hechos. Si algo es una inferencia, dilo.
- Las sugerencias deben ser prácticas y ejecutables por un lead en el día a día: métodos concretos (p. ej. checklist de autonomía, regla "trae 2 opciones antes de preguntar", técnica SBI para feedback, DESC para asertividad, role-play, pair review, shadowing, timeboxing de 15 min antes de escalar, plantillas de pregunta, etc.), con pasos y cómo medir si funciona.
- Ten en cuenta lo que ya se probó y su resultado: no repitas lo que "no funcionó" sin cambiarlo; refuerza lo que "funcionó".
- Fechas en formato AAAA-MM-DD.`;

const langRule = (lang?: string) =>
  lang === "en" ? "IDIOMA DE SALIDA: inglés (English)." : lang === "auto"
    ? "IDIOMA DE SALIDA: el idioma predominante de la transcripción (español o inglés). Los valores de los enums (kind, owner, priority, outcome) se mantienen exactamente como están definidos."
    : "IDIOMA DE SALIDA: español neutro.";

// ---------------------------------------------------------------------
async function callClaude(system: string, user: string, tool: Record<string, unknown>, maxTokens = 8000) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Falta el secreto ANTHROPIC_API_KEY en Supabase (Edge Functions → Secrets).");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: system + `\n\nResponde ÚNICAMENTE llamando a la herramienta "${tool.name}", sin texto adicional.`,
      tools: [tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  const block = (data.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (block) return block.input;
  // Respaldo: si respondió en texto, intentar leer el JSON
  const text = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* sigue */ } }
  throw new Error("La IA no devolvió el formato esperado. Vuelve a intentarlo.");
}

const str = { type: "string" };
const strArr = { type: "array", items: str };
const suggestionSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Nombre corto del método o idea" },
    why: { type: "string", description: "Qué problema ataca, basado en lo observado" },
    how: { type: "string", description: "Pasos concretos para el lead (2-5 pasos, separados por saltos de línea)" },
    category: { type: "string", description: `Una de: ${CATEGORIES}` },
    resources: { type: "string", description: "Herramientas, plantillas, frases de ejemplo o cómo medir el avance" },
  },
  required: ["title", "why", "how", "category"],
};

// Recomendaciones de liderazgo para quien dirige la reunión (Cambio 12)
const coachingSchema = {
  type: "array",
  description: "2 a 4 recomendaciones de liderazgo/coaching para QUIEN DIRIGE la reunión (Gus o el lead que la subió): cómo acompañar, dar feedback, hacer seguimiento o destrabar a las personas mencionadas. Concretas y accionables.",
  items: {
    type: "object",
    properties: {
      title: { type: "string", description: "La recomendación en una frase" },
      for_person: { type: "string", description: "Nombre de la persona a la que apunta, o 'Equipo'" },
      why: { type: "string", description: "Qué se observó en la reunión que la justifica (1-2 frases)" },
      steps: { ...{ type: "array", items: { type: "string" } }, description: "2-4 pasos concretos" },
      first_step: { type: "string", description: "Lo primero que puede hacer esta semana" },
      say_it: { type: "string", description: "Una frase de ejemplo para decirlo en la conversación" },
      measure: { type: "string", description: "Cómo saber en 2-4 semanas si funcionó" },
    },
    required: ["title", "for_person", "why", "steps", "first_step", "say_it", "measure"],
  },
};

// ---------------------------------------------------------------------
type DB = ReturnType<typeof createClient>;

async function roster(db: DB) {
  const { data: groups } = await db.from("groups").select("id,name,team");
  const { data: people } = await db.from("people").select("id,full_name,nickname,title,focus,group_id,is_lead,status,notes");
  const { data: gl } = await db.from("group_leads").select("person_id");
  const leads = new Set([...(gl ?? []).map((x: any) => x.person_id), ...(people ?? []).filter((p: any) => p.is_lead).map((p: any) => p.id)]);
  (people ?? []).forEach((p: any) => (p.is_lead = leads.has(p.id)));
  const gname = new Map((groups ?? []).map((g: any) => [g.id, g.name]));
  const lines = (people ?? []).map((p: any) =>
    `${p.id} | ${p.full_name}${p.nickname ? ` ("${p.nickname}")` : ""} | grupo: ${gname.get(p.group_id) ?? "—"}${p.is_lead ? " | LEAD" : ""}${p.status !== "activo" ? ` | ${p.status}` : ""}${p.focus ? ` | foco: ${p.focus}` : ""}`
  );
  return { people: people ?? [], groups: groups ?? [], text: lines.join("\n") };
}

async function personContext(db: DB, personIds: string[], opts: { insights?: number } = {}) {
  if (!personIds.length) return "";
  const [{ data: people }, { data: ins }, { data: sug }, { data: act }] = await Promise.all([
    db.from("people").select("id,full_name").in("id", personIds),
    db.from("insights").select("person_id,kind,category,body,created_at").in("person_id", personIds)
      .order("created_at", { ascending: false }).limit((opts.insights ?? 6) * personIds.length),
    db.from("suggestions").select("id,person_id,title,status,outcome,how,updated_at").in("person_id", personIds)
      .neq("status", "descartada"),
    db.from("actions").select("person_id,body,status,due_date").in("person_id", personIds)
      .in("status", ["pendiente", "en curso", "pausado"]),
  ]);
  const sugIds = (sug ?? []).map((s: any) => s.id);
  const { data: upd } = sugIds.length
    ? await db.from("suggestion_updates").select("suggestion_id,outcome,comment,created_at")
        .in("suggestion_id", sugIds).order("created_at", { ascending: false })
    : { data: [] as any[] };
  const out: string[] = [];
  for (const p of people ?? []) {
    const lim = opts.insights ?? 6;
    const i = (ins ?? []).filter((x: any) => x.person_id === p.id).slice(0, lim);
    const s = (sug ?? []).filter((x: any) => x.person_id === p.id);
    const a = (act ?? []).filter((x: any) => x.person_id === p.id);
    if (!i.length && !s.length && !a.length) continue;
    out.push(`## ${p.full_name} (${p.id})`);
    i.forEach((x: any) => out.push(`- [${x.created_at.slice(0, 10)}] ${x.kind}${x.category ? `/${x.category}` : ""}: ${x.body}`));
    s.forEach((x: any) => {
      const u = (upd ?? []).filter((y: any) => y.suggestion_id === x.id).slice(0, 2)
        .map((y: any) => `${y.outcome ?? ""} ${y.comment ?? ""}`.trim()).filter(Boolean).join(" · ");
      out.push(`- Sugerencia ${x.id} "${x.title}" → estado: ${x.status}${x.outcome ? `, resultado: ${x.outcome}` : ""}${u ? `, reportes: ${u}` : ""}`);
    });
    a.forEach((x: any) => out.push(`- Pendiente abierto: ${x.body} (${x.status}${x.due_date ? `, vence ${x.due_date}` : ""})`));
  }
  return out.join("\n");
}

// Reuniones anteriores que quien pide puede conocer (solo resumen y temas)
type Who = { userId: string; myPid: string | null; isAdmin: boolean };
async function prevMeetings(admin: DB, personId: string, who: Who, excludeId?: string, limit = 4) {
  const { data } = await admin.from("meetings").select("id,meeting_date,kind,summary,analysis,created_by,shared_with_lead,status")
    .eq("person_id", personId).not("summary", "is", null).order("meeting_date", { ascending: false }).limit(20);
  return (data ?? []).filter((m: any) => m.id !== excludeId && (
    who.isAdmin || m.created_by === who.userId ||
    (m.shared_with_lead && m.status === "aplicado" && personId === who.myPid)
  )).slice(0, limit);
}

// ---------------------------------------------------------------------
async function analyze(db: DB, admin: DB, meetingId: string, who: Who) {
  const { userId, isAdmin } = who;
  const { data: m, error } = await db.from("meetings").select("*").eq("id", meetingId).single();
  if (error || !m) throw new Error("Reunión no encontrada.");
  if (!isAdmin && m.created_by !== userId) throw new Error("Solo puedes analizar reuniones que subiste tú.");
  if (!m.transcript || m.transcript.trim().length < 20) throw new Error("La reunión no tiene transcripción o notas.");

  // El roster completo (solo nombres y grupos) se lee con permisos de servicio
  // para que la IA reconozca a cualquier persona mencionada, aunque el lead no la vea.
  const r = await roster(admin);
  const { data: creator } = m.created_by
    ? await admin.from("profiles").select("role,person_id").eq("id", m.created_by).single()
    : { data: null as any };
  const uploader: any = creator?.role === "lead" ? r.people.find((p: any) => p.id === creator.person_id) : null;
  const withP: any = r.people.find((p: any) => p.id === m.person_id);
  // Contexto: la persona + su grupo (si es lead). Se lee con los permisos de quien pide.
  let ids: string[] = withP ? [withP.id] : [];
  if (withP?.is_lead && withP.group_id) ids = r.people.filter((p: any) => p.group_id === withP.group_id).map((p: any) => p.id);
  if (uploader && uploader.group_id) ids = [...new Set([...ids, ...r.people.filter((p: any) => p.group_id === uploader.group_id).map((p: any) => p.id)])];
  const ctx = await personContext(db, ids, { insights: 4 });
  const prev = m.person_id ? await prevMeetings(admin, m.person_id, who, m.id, 3) : [];

  const tool = {
    name: "registrar_analisis",
    description: "Registra el análisis estructurado de la reunión.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Resumen objetivo de 4-8 frases: qué se habló, decisiones, dirección. NO incluyas comentarios sobre otros leads (personas marcadas LEAD que no sean con quien fue la reunión): esos van solo en people." },
        topics: { ...strArr, description: "Temas tratados (cortos)" },
        people: {
          type: "array",
          description: "Una entrada por cada persona del equipo mencionada con algo relevante.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nombre tal como aparece en el roster (o como se dijo si no está)" },
              person_id: { type: ["string", "null"], description: "id EXACTO del roster, o null si no se puede identificar con seguridad" },
              feedback: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: KINDS },
                    category: { type: "string", description: `Una de: ${CATEGORIES}` },
                    body: { type: "string", description: "Observación concreta en 1-2 frases" },
                  },
                  required: ["kind", "body"],
                },
              },
              suggestions: { type: "array", description: "0-2 métodos concretos para esta persona (solo si hay algo que trabajar)", items: suggestionSchema },
            },
            required: ["name", "person_id", "feedback", "suggestions"],
          },
        },
        actions: {
          type: "array",
          description: "Siguientes pasos acordados o necesarios.",
          items: {
            type: "object",
            properties: {
              body: { type: "string", description: "Acción concreta empezando con verbo" },
              person_id: { type: ["string", "null"], description: "Sobre quién es (id del roster) o null si es general" },
              owner: { type: "string", enum: ["gus", "lead", "persona"], description: "A cargo de: por defecto 'lead' (el lead responsable de esa persona). 'persona' solo si la tarea la ejecuta claramente la propia persona (p. ej. 'Dylan termina el curso'). 'gus' solo si Gus se comprometió a hacerlo." },
              due_date: { type: ["string", "null"], description: "AAAA-MM-DD solo si se mencionó o se deduce claramente" },
              priority: { type: "string", enum: ["alta", "media", "baja"], description: "alta: urgente o con impacto en cliente/calidad/personas; media: importante sin urgencia; baja: mejora o seguimiento suave" },
            },
            required: ["body", "person_id", "owner", "due_date", "priority"],
          },
        },
        suggestion_updates: {
          type: "array",
          description: "Si en la reunión se reportó cómo fue alguna sugerencia EXISTENTE del contexto.",
          items: {
            type: "object",
            properties: {
              suggestion_id: str,
              outcome: { type: "string", enum: ["funcionó", "parcial", "no funcionó"] },
              comment: str,
            },
            required: ["suggestion_id", "outcome", "comment"],
          },
        },
        next_meeting_topics: { ...strArr, description: "Temas a retomar en la próxima reunión" },
        coaching: coachingSchema,
        risks: { ...strArr, description: "Riesgos o alertas (personas, plazos, calidad)" },
      },
      required: ["summary", "topics", "people", "actions", "suggestion_updates", "next_meeting_topics", "risks", "coaching"],
    },
  };

  const user = `REUNIÓN: ${m.kind} del ${m.meeting_date} con ${withP?.full_name ?? "—"}${withP?.is_lead ? " (lead de grupo)" : ""}.${uploader ? `\nLa subió el lead ${uploader.full_name}, que gestiona a esa gente.` : ""}
${langRule("auto")}
Hoy es ${new Date().toISOString().slice(0, 10)}.

ROSTER (id | nombre | grupo):
${r.text}

REUNIONES ANTERIORES CON ESTA PERSONA:
${(prev ?? []).map((p: any) => `- ${p.meeting_date}: ${p.summary}`).join("\n") || "—"}

CONTEXTO PREVIO (feedback, sugerencias y su resultado, pendientes abiertos):
${ctx || "—"}

TRANSCRIPCIÓN / NOTAS (puede estar en español o inglés, con apodos y errores de transcripción):
"""
${m.transcript.slice(0, 120000)}
"""

Analiza y registra. Identifica a cada persona con el roster (apodos como "Vike", "Gustavish", "Javi A.", "Sebas", "Fer", "Diego D." cuentan). Si una persona no está en el roster, deja person_id en null.`;

  const analysis = await callClaude(COACH_STYLE, user, tool, 10000);
  const { error: upErr } = await db.from("meetings").update({ analysis, summary: analysis.summary, status: "analizado" }).eq("id", m.id);
  if (upErr) throw new Error(upErr.message);
  return { analysis };
}

// Datos de Bamboo e incidencias de la persona para la IA (Cambio 18). Si algo falta, se omite.
async function bambooContext(db: any, p: any): Promise<string> {
  const out: string[] = [];
  const hoy = new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
  const mes = hoy.slice(0, 7);
  const hace90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  try {
    if (p.bamboo_id) {
      const [g, d, tr, pto] = await Promise.all([
        db.from("bamboo_goals").select("title,pct,due,state,overdue,soon").eq("bamboo_id", p.bamboo_id),
        db.from("bamboo_days").select("day,hours,expected,state").eq("bamboo_id", p.bamboo_id).gte("day", mes + "-01").lte("day", hoy),
        db.from("bamboo_training").select("day,hours,name").eq("bamboo_id", p.bamboo_id).gte("day", hoy.slice(0, 4) + "-01-01"),
        db.from("bamboo_pto").select("available,total,unplanned,level").eq("bamboo_id", p.bamboo_id).maybeSingle(),
      ]);
      const dias = (d.data ?? []).filter((x: any) => x.state !== "en_plazo");
      if (dias.length) {
        const esp = dias.reduce((a: number, x: any) => a + Number(x.expected), 0);
        const cub = dias.reduce((a: number, x: any) => a + (x.state === "falta" ? 0 : x.state === "parcial" ? Math.min(Number(x.hours), Number(x.expected)) : Number(x.expected)), 0);
        const pend = dias.filter((x: any) => ["falta", "parcial"].includes(x.state)).map((x: any) => x.day.slice(8));
        const mas = dias.filter((x: any) => ["exceso", "extra"].includes(x.state)).length;
        out.push(`Horas del mes (Bamboo): ${esp ? Math.floor((100 * cub) / esp) : 100}% registrado${pend.length ? `; días pendientes: ${pend.join(", ")}` : "; sin días pendientes"}${mas ? `; ${mas} día(s) con horas de más` : ""}.`);
      }
      for (const x of (g.data ?? []).filter((x: any) => x.state === "en_progreso")) {
        out.push(`Goal "${x.title}": ${Math.round(Number(x.pct))}%${x.overdue ? ", VENCIDO" : x.soon ? `, vence pronto (${x.due})` : x.due ? `, vence ${x.due}` : ""}.`);
      }
      const h = (tr.data ?? []).reduce((a: number, x: any) => a + Number(x.hours), 0);
      if ((tr.data ?? []).length) out.push(`Training en el año: ${h}h en ${(tr.data ?? []).length} curso(s).`);
      if (pto.data) out.push(`Vacaciones: ${pto.data.unplanned} días sin planificar de ${pto.data.total}${pto.data.level === "low" ? " (muy atrasado)" : pto.data.level === "mid" ? " (algo atrasado)" : ""}.`);
    }
    const { data: inc } = await db.from("incidents").select("occurred_on,category,severity,detail,note,voided")
      .eq("person_id", p.id).gte("occurred_on", hace90).order("occurred_on", { ascending: false });
    const act = (inc ?? []).filter((x: any) => !x.voided);
    if (act.length) {
      out.push(`Incidencias (últimos 90 días): ${act.length}.`);
      for (const x of act.slice(0, 8)) out.push(`- ${x.occurred_on} ${x.category} (${x.severity}): ${x.note || x.detail || ""}`);
    }
  } catch (_) { /* sin datos extra */ }
  return out.join("\n");
}

const SOBRIO = `ESTILO DE SALIDA (obligatorio): sobrio y al punto, para que un líder lo lea en 1 minuto.
- Frases cortas, sin relleno, sin adjetivos innecesarios, sin repetir lo mismo en varias secciones.
- Cada punto debe decir qué pasa y cómo abordarlo. Usa números concretos cuando existan (horas, %, incidencias).
- Si una sección no tiene nada útil, déjala vacía.`;

// ---------------------------------------------------------------------
async function prep(db: DB, admin: DB, personId: string, who: Who, lang?: string) {
  const { data: p } = await db.from("people").select("*").eq("id", personId).single();
  if (!p) throw new Error("Persona no encontrada o sin acceso.");
  let ids = [p.id];
  if (p.is_lead && p.group_id) {
    const { data: g } = await db.from("people").select("id").eq("group_id", p.group_id);
    ids = (g ?? []).map((x: any) => x.id);
  }
  const ctx = await personContext(db, ids, { insights: 8 });
  const prev = await prevMeetings(admin, p.id, who);
  const bb = await bambooContext(db, p);

  const tool = {
    name: "preparar_reunion",
    description: "Agenda de preparación para la próxima reunión.",
    input_schema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "Una frase de máximo 15 palabras: dónde estamos con esta persona/grupo" },
        summary: { ...strArr, description: "Resumen para leer en 30 segundos: 3 a 5 puntos de máximo 18 palabras cada uno, lo esencial y cómo abordarlo (incluye horas/incidencias si importan)" },
        last_time: { ...strArr, description: "Qué quedó de la última reunión (máximo 3, cortos)" },
        open_items: { ...strArr, description: "Pendientes abiertos a revisar (máximo 3, cortos)" },
        what_worked: { ...strArr, description: "Máximo 3, cortos" },
        what_didnt: { ...strArr, description: "Máximo 3, cortos" },
        suggested_points: {
          type: "array",
          items: {
            type: "object",
            properties: { topic: str, why: { type: "string", description: "Máximo 15 palabras" }, how_to_open: { type: "string", description: "Una pregunta corta (máximo 15 palabras) para abrir el tema" } },
            required: ["topic", "why", "how_to_open"],
          },
        },
        questions: { ...strArr, description: "Máximo 3 preguntas clave, de máximo 12 palabras" },
        people: {
          type: "array",
          description: "Solo si la persona es lead: estado breve de cada miembro de su grupo con algo relevante",
          items: { type: "object", properties: { name: str, status: str, focus: str }, required: ["name", "status", "focus"] },
        },
      },
      required: ["headline", "summary", "last_time", "open_items", "what_worked", "what_didnt", "suggested_points", "questions", "people"],
    },
  };
  const user = `${langRule(lang)}
Prepara mi próxima reunión con ${p.full_name}${p.is_lead ? " (lead de grupo)" : ""}. Rol: ${p.title ?? "—"}. Foco: ${p.focus ?? "—"}. Notas: ${p.notes ?? "—"}.
Hoy es ${new Date().toISOString().slice(0, 10)}.

REUNIONES ANTERIORES:
${(prev ?? []).map((x: any) => `- ${x.meeting_date} (${x.kind}): ${x.summary ?? ""}${x.analysis?.next_meeting_topics?.length ? ` | Para retomar: ${x.analysis.next_meeting_topics.join("; ")}` : ""}`).join("\n") || "—"}

CONTEXTO (feedback, sugerencias y resultados, pendientes):
${ctx || "—"}

DESEMPEÑO (Bamboo e incidencias):
${bb || "—"}

${SOBRIO}
Máximo 3 puntos sugeridos.`;
  return { prep: await callClaude(COACH_STYLE, user, tool, 3000) };
}

// ---------------------------------------------------------------------
async function ideas(db: DB, personId: string, focus?: string, lang?: string) {
  const { data: p } = await db.from("people").select("*").eq("id", personId).single();
  if (!p) throw new Error("Persona no encontrada.");
  const ctx = await personContext(db, [p.id], { insights: 15 });
  const tool = {
    name: "proponer_ideas",
    description: "Propone métodos nuevos para el desarrollo de la persona.",
    input_schema: {
      type: "object",
      properties: { suggestions: { type: "array", items: suggestionSchema, description: "3 ideas distintas y concretas" } },
      required: ["suggestions"],
    },
  };
  const user = `${langRule(lang)}
Propón 3 métodos nuevos para ayudar a ${p.full_name} (${p.title ?? "—"}; foco: ${p.focus ?? "—"}).
${focus ? `Gus quiere enfocarse en: ${focus}` : "Enfócate en lo que más impacto tenga según el historial."}
No repitas sugerencias existentes; ajusta según lo que funcionó y lo que no.

HISTORIAL:
${ctx || "Sin historial todavía."}

DESEMPEÑO (Bamboo e incidencias):
${(await bambooContext(db, p)) || "—"}

${SOBRIO}`;
  const out = await callClaude(COACH_STYLE, user, tool, 3000);
  const rows = (out.suggestions ?? []).map((s: any) => ({
    person_id: p.id, title: s.title, why: s.why, how: s.how, category: s.category, resources: s.resources ?? null,
    source: "ia", status: "propuesta",
  }));
  if (rows.length) {
    const { error } = await db.from("suggestions").insert(rows);
    if (error) throw new Error(error.message);
  }
  return { created: rows.length, titles: rows.map((r: any) => r.title) };
}

// Recomendaciones para una reunión ya analizada que no las tenga (Cambio 12)
async function recommend(db: DB, admin: DB, meetingId: string, who: Who) {
  const { data: m } = await db.from("meetings").select("*").eq("id", meetingId).single();
  if (!m) throw new Error("Reunión no encontrada.");
  if (!who.isAdmin && m.created_by !== who.userId) throw new Error("Solo puedes pedir recomendaciones de reuniones que subiste tú.");
  if (!m.transcript && !m.summary) throw new Error("La reunión no tiene texto.");
  const { data: p } = m.person_id ? await admin.from("people").select("full_name").eq("id", m.person_id).single() : { data: null as any };
  const ids = (m.analysis?.people ?? []).map((x: any) => x.person_id).filter(Boolean);
  const ctx = await personContext(db, ids, { insights: 4 });
  const tool = {
    name: "recomendar",
    description: "Recomendaciones de liderazgo para quien dirige la reunión.",
    input_schema: { type: "object", properties: { coaching: coachingSchema }, required: ["coaching"] },
  };
  const { data: creator } = m.created_by ? await admin.from("profiles").select("role,person_id").eq("id", m.created_by).single() : { data: null as any };
  const { data: up } = creator?.role === "lead" && creator.person_id ? await admin.from("people").select("full_name").eq("id", creator.person_id).single() : { data: null as any };
  const user = `${langRule("auto")}
REUNIÓN: ${m.kind} del ${m.meeting_date} con ${p?.full_name ?? "—"}.
${up ? `La dirigió y subió el lead ${up.full_name}: las recomendaciones son para él/ella, sobre cómo acompañar a su gente.` : "La dirigió Gus (Team Lead): las recomendaciones son para Gus."}
RESUMEN: ${m.summary ?? "—"}
CONTEXTO PREVIO:
${ctx || "—"}

TRANSCRIPCIÓN / NOTAS:
"""
${String(m.transcript ?? "").slice(0, 80000)}
"""`;
  const out = await callClaude(COACH_STYLE, user, tool, 3000);
  const analysis = { ...(m.analysis ?? {}), coaching: out.coaching ?? [] };
  const { error } = await db.from("meetings").update({ analysis }).eq("id", m.id);
  if (error) throw new Error(error.message);
  return { coaching: analysis.coaching };
}

// ---------------------------------------------------------------------
async function ideaSolutions(db: DB, admin: DB, ideaId: string, lang?: string) {
  const { data: idea } = await db.from("ideas").select("*").eq("id", ideaId).single();
  if (!idea) throw new Error("Idea no encontrada.");
  const { data: others } = await db.from("ideas").select("title,status,kind").neq("id", ideaId).limit(40);
  const tool = {
    name: "proponer_soluciones",
    description: "Analiza un problema o idea de mejora del equipo y propone alternativas.",
    input_schema: {
      type: "object",
      properties: {
        diagnosis: { type: "string", description: "Qué está pasando realmente / qué se busca lograr (2-3 frases)" },
        questions: { ...strArr, description: "Datos que faltan para decidir (máx. 3)" },
        options: {
          type: "array",
          description: "2-4 alternativas distintas, de la más rápida a la más estructural",
          items: {
            type: "object",
            properties: {
              title: str,
              description: str,
              steps: { ...strArr, description: "Pasos concretos" },
              effort: { type: "string", enum: ["bajo", "medio", "alto"] },
              impact: { type: "string", enum: ["bajo", "medio", "alto"] },
              horizon: { type: "string", enum: ["corto", "mediano", "largo"] },
            },
            required: ["title", "description", "steps", "effort", "impact", "horizon"],
          },
        },
        quick_win: { type: "string", description: "Lo que se puede hacer esta misma semana" },
        related: { ...strArr, description: "Títulos de otras ideas del banco relacionadas, si hay" },
      },
      required: ["diagnosis", "questions", "options", "quick_win", "related"],
    },
  };
  const user = `${langRule(lang)}
Contexto: equipo de operaciones que trabaja con WOMS, Salesforce, PowerApps, Bynder/WebDAM, Landing Pages, Site Services, Postings, QA.
${idea.kind === "problema" ? "PROBLEMA" : "IDEA DE MEJORA"} (${idea.horizon} plazo): ${idea.title}
Detalle: ${idea.description ?? "—"}
${idea.raised_by ? `Lo planteó: ${idea.raised_by}` : ""}

Otras ideas del banco: ${(others ?? []).map((o: any) => `${o.title} [${o.status}]`).join("; ") || "—"}

Propón soluciones prácticas y realistas (herramientas, automatizaciones, cambios de proceso, atajos). Si mencionas una herramienta, di para qué sirve.`;
  const out = await callClaude(COACH_STYLE, user, tool, 3000);
  const { error } = await admin.from("ideas").update({ ai_solutions: out, status: idea.status === "nueva" ? "en análisis" : idea.status }).eq("id", idea.id);
  if (error) throw new Error(error.message);
  return { solutions: out };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function notify(admin: DB, reviewId: string, userId: string) {
  const { data: rv } = await admin.from("reviews").select("*").eq("id", reviewId).single();
  if (!rv || rv.created_by !== userId) throw new Error("Revisión no encontrada.");
  if (rv.emailed) return { emailed: true, already: true };
  const { data: m } = await admin.from("meetings").select("title,meeting_date,kind,person_id,summary").eq("id", rv.meeting_id).single();
  const { data: withP } = m?.person_id ? await admin.from("people").select("full_name").eq("id", m.person_id).single() : { data: null as any };
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { emailed: false, reason: "Falta RESEND_API_KEY" };
  const items = (rv.items ?? []) as any[];
  const title = m?.title || `${m?.kind ?? "Reunión"} con ${withP?.full_name ?? "—"}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
  <h2 style="margin:0 0 8px">${esc(rv.author_name ?? "Un lead")} subió una reunión</h2>
  <p style="color:#555;margin:0 0 12px">${esc(title)} · ${esc(m?.meeting_date ?? "")}</p>
  ${m?.summary ? `<p>${esc(m.summary)}</p>` : ""}
  <h3 style="margin:16px 0 6px">${items.length ? `Puntos para que revises (${items.length})` : "No hay puntos para ti; es solo un aviso."}</h3>
  <ul>${items.map((i) => `<li><b>${esc(i.person_name ?? "—")}</b>: ${esc(i.body ?? i.title ?? "")}</li>`).join("")}</ul>
  <p><a href="${esc(APP_URL)}#/validar" style="background:#23535a;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Revisar en Team Coach</a></p>
</div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Team Coach <onboarding@resend.dev>",
      to: [NOTIFY_EMAIL],
      subject: `${rv.author_name ?? "Un lead"} subió "${title}"${items.length ? ` · ${items.length} por revisar` : ""}`,
      html,
    }),
  });
  if (!r.ok) return { emailed: false, reason: `Resend ${r.status}: ${await r.text()}` };
  await admin.from("reviews").update({ emailed: true }).eq("id", rv.id);
  return { emailed: true };
}

// Historial de IA (Cambio 17): guarda lo generado con quién y cuándo. Si la tabla no existe, no falla.
async function guardarIA(admin: any, who: Who, personId: string, kind: string, result: unknown, lang?: string) {
  try {
    let nombre = who.isAdmin ? "Gus" : null;
    if (who.myPid) {
      const { data: me } = await admin.from("people").select("full_name").eq("id", who.myPid).maybeSingle();
      nombre = (me as any)?.full_name ?? nombre;
    }
    const { data } = await admin.from("ai_generations")
      .insert({ person_id: personId, kind, result, lang: lang ?? null, created_by: who.userId, created_by_name: nombre ?? "—" })
      .select("id,created_at,created_by_name").single();
    return data ?? null;
  } catch (_) { return null; }
}

// Comprueba que el correo y la contraseña realmente permiten entrar (devuelve el error o null)
async function probarLogin(email: string, password: string): Promise<string | null> {
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anon) return null;
  const c = createClient(SUPABASE_URL, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  if (data.session) await c.auth.signOut().catch(() => {});
  return null;
}

// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    // Cliente con la sesión del usuario → respeta RLS
    const db = createClient(SUPABASE_URL, apikey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!user) return json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, 401);
    const { data: me } = await db.from("profiles").select("role,person_id").eq("id", user.id).single();
    const isAdmin = me?.role === "admin";

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const who: Who = { userId: user.id, myPid: me?.person_id ?? null, isAdmin };
    if (action === "prep") {
      const r = await prep(db, admin, body.person_id, who, body.lang);
      return json({ ...r, generation: await guardarIA(admin, who, body.person_id, "prep", r.prep, body.lang) });
    }
    if (action === "analyze") return json(await analyze(db, admin, body.meeting_id, who));
    if (action === "idea_solutions") return json(await ideaSolutions(db, admin, body.idea_id, body.lang));
    if (action === "recommend") return json(await recommend(db, admin, body.meeting_id, who));
    if (action === "notify") return json(await notify(admin, body.review_id, user.id));

    if (!isAdmin) return json({ error: "Solo Gus (admin) puede usar esta acción." }, 403);

    if (action === "ideas") {
      const r = await ideas(db, body.person_id, body.focus, body.lang);
      await guardarIA(admin, who, body.person_id, "ideas", { focus: body.focus ?? null, titles: r.titles }, body.lang);
      return json(r);
    }

    if (action === "create_user" || action === "reset_password") {
      const password = String(body.password ?? "").trim();
      if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
      if (action === "create_user") {
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!email.includes("@")) return json({ error: "Correo inválido." }, 400);
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) return json({ error: error.message }, 400);
        await admin.from("profiles").upsert({ id: data.user.id, email, role: "lead", person_id: body.person_id ?? null, must_change_password: false });
        if (body.person_id) await admin.from("people").update({ email }).eq("id", body.person_id);
        const check = await probarLogin(email, password);
        if (check) return json({ error: `Se creó el usuario, pero la contraseña no funciona al entrar: ${check}. Usa "Nueva contraseña".` }, 500);
        return json({ ok: true, user_id: data.user.id, verified: true });
      } else {
        const { data: upd, error } = await admin.auth.admin.updateUserById(body.user_id, { password, email_confirm: true });
        if (error) return json({ error: error.message }, 400);
        const check = upd?.user?.email ? await probarLogin(upd.user.email, password) : null;
        if (check) return json({ error: `La contraseña no funciona al entrar: ${check}` }, 500);
        return json({ ok: true, verified: true });
      }
    }
    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

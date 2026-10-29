// Edge Function "ai-proxy" (Cambio 29) — la IA del Performance Dashboard, ahora dentro de Team Coach.
// Único lugar donde vive la API key de Anthropic: el navegador manda {feature, prompt}, esta función valida
// quién es (login y rol de Team Coach), si tiene permiso para esa función, aplica los topes de costo
// y llama a Anthropic con la key secreta.
//
// Secretos:
//    ANTHROPIC_API_KEY   (obligatorio)
//    ANTHROPIC_URL       (opcional, solo para pruebas locales contra un simulador)
//
// Roles (public.profiles): admin → owner, lead → lead, member → contractor. Un acceso desactivado no entra.
// Topes (perf.app_settings, clave "ai_limits", ver 21_perf_ai_tope.sql), en dólares:
//    dia_total_usd, mes_total_usd       → para todos, también el admin
//    dia_persona_usd, mes_persona_usd   → por persona, todos menos el admin
//    llamadas_dia_persona               → por persona, todos menos el admin
// Antes de llamar se suma lo gastado más el peor caso de esta llamada; si pasa el tope, no se llama.
// Días y meses en horario de Bolivia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-5-5";

// Precio en dólares por millón de tokens (entrada, salida). Si cambia el modelo, actualizar aquí.
const PRICES: Record<string, { input: number; output: number }> = {
  [HAIKU]: { input: 1, output: 5 },
  [SONNET]: { input: 2, output: 10 },
};

// Modelo y tope de salida los decide el SERVIDOR (el navegador no puede pedir otro).
const FEATURES: Record<string, { model: string; maxTokens: number; fallback: "owner" | "lead" | "off" }> = {
  // Los topes de salida son solo un techo de seguridad: se cobra únicamente lo que realmente se genera.
  ping:                { model: HAIKU,  maxTokens: 64,   fallback: "lead" },
  qa_categorize:       { model: HAIKU,  maxTokens: 4096, fallback: "lead" },
  capacity_note:       { model: SONNET, maxTokens: 2000, fallback: "lead" },
  group_capacity_note: { model: SONNET, maxTokens: 2000, fallback: "lead" },
  monthly_narrative:   { model: SONNET, maxTokens: 3000, fallback: "lead" },
  coaching_note:       { model: SONNET, maxTokens: 2000, fallback: "owner" },
};
const MAX_PROMPT_CHARS = 30000;
const LIMITES_POR_DEFECTO = { dia_total_usd: 1, mes_total_usd: 10, dia_persona_usd: 0.25, mes_persona_usd: 2, llamadas_dia_persona: 150 };

const costo = (model: string, entrada: number, salida: number) => {
  const p = PRICES[model];
  return p ? (entrada * p.input + salida * p.output) / 1e6 : 0;
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return reply(500, { error: "Falta el secreto ANTHROPIC_API_KEY en Supabase (Edge Functions > Secrets)." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const perf = admin.schema("perf");

  // 1) ¿Quién llama? (token de sesión de Team Coach)
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Inicia sesión primero." });
  const { data: u, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !u?.user) return reply(401, { error: "Sesión inválida. Vuelve a iniciar sesión." });
  const { data: perfil } = await admin.from("profiles").select("role, disabled, person_id").eq("id", u.user.id).maybeSingle();
  const role = !perfil || perfil.disabled ? null : ({ admin: "owner", lead: "lead", member: "contractor" } as Record<string, string>)[perfil.role] ?? null;
  if (!role) return reply(403, { error: "Tu cuenta no está habilitada." });
  const filtro = perfil!.person_id ? `tc_user_id.eq.${u.user.id},tc_person_id.eq.${perfil!.person_id}` : `tc_user_id.eq.${u.user.id}`;
  const { data: personas } = await perf.from("people").select("id").or(filtro).limit(1);
  const personId: string | null = personas?.[0]?.id ?? null;
  if (!personId) return reply(403, { error: "Tu cuenta no tiene ficha en el dashboard." });

  // 2) ¿Qué pidió?
  let payload: { feature?: string; prompt?: string };
  try { payload = await req.json(); } catch { return reply(400, { error: "JSON inválido." }); }
  const feature = String(payload.feature || "");
  const cfg = FEATURES[feature];
  if (!cfg) return reply(400, { error: "Función de IA desconocida." });
  const prompt = String(payload.prompt || "");
  if (!prompt.trim()) return reply(400, { error: "Prompt vacío." });
  if (prompt.length > MAX_PROMPT_CHARS) return reply(400, { error: "El prompt es demasiado largo." });

  // 3) ¿Tiene permiso? (configurable por el admin en app_settings.ai_permissions) y topes (app_settings.ai_limits)
  const { data: ajustes } = await perf.from("app_settings").select("key, value").in("key", ["ai_permissions", "ai_limits"]);
  const ajuste = (k: string) => ajustes?.find((a) => a.key === k)?.value ?? {};
  let level = cfg.fallback;
  const configured = ajuste("ai_permissions")?.[feature];
  if (configured === "owner" || configured === "lead" || configured === "off") level = configured;
  const allowed = level === "off" ? false : level === "owner" ? role === "owner" : (role === "owner" || role === "lead");
  if (!allowed) return reply(403, { error: level === "off" ? "Esta función de IA está apagada." : "No tienes permiso para esta función de IA." });

  // 4) Topes de costo y de llamadas. Peor caso de esta llamada: ~1 token cada 3 caracteres + toda la salida permitida.
  const lim = { ...LIMITES_POR_DEFECTO, ...ajuste("ai_limits") };
  const { data: g, error: gerr } = await perf.rpc("ai_gasto", { p_person: personId }).single();
  if (gerr || !g) return reply(500, { error: "No se pudo revisar el gasto de IA: " + (gerr?.message ?? "sin datos") });
  const peor = costo(cfg.model, Math.ceil(prompt.length / 3), cfg.maxTokens);
  const pasa = (gastado: unknown, tope: unknown) => Number(gastado) + peor <= Number(tope);
  if (!pasa(g.hoy_total, lim.dia_total_usd)) return reply(429, { error: "Se llegó al tope diario de gasto de IA del equipo. Intenta mañana." });
  if (!pasa(g.mes_total, lim.mes_total_usd)) return reply(429, { error: "Se llegó al tope mensual de gasto de IA del equipo." });
  if (role !== "owner") {
    if (Number(g.llamadas_hoy_persona) >= Number(lim.llamadas_dia_persona)) return reply(429, { error: "Llegaste al tope diario de usos de IA. Intenta mañana." });
    if (!pasa(g.hoy_persona, lim.dia_persona_usd)) return reply(429, { error: "Llegaste a tu tope diario de gasto de IA. Intenta mañana." });
    if (!pasa(g.mes_persona, lim.mes_persona_usd)) return reply(429, { error: "Llegaste a tu tope mensual de gasto de IA." });
  }

  // 5) Llamada a Anthropic con la key secreta
  const ares = await fetch(Deno.env.get("ANTHROPIC_URL") || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await ares.json().catch(() => ({}));
  if (!ares.ok) {
    const msg = data?.error?.message || `Error ${ares.status}`;
    return reply(502, { error: "Anthropic: " + msg });
  }
  const entrada = data?.usage?.input_tokens ?? 0, salida = data?.usage?.output_tokens ?? 0;
  await perf.from("ai_usage").insert({
    person_id: personId, feature, model: cfg.model,
    input_tokens: entrada, output_tokens: salida, cost_usd: costo(cfg.model, entrada, salida),
  });
  if (data?.stop_reason === "refusal") return reply(422, { error: "La IA no respondió esta solicitud. Prueba con otro texto." });
  const text = (data.content || []).filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("\n").trim();
  return reply(200, { text, truncated: data?.stop_reason === "max_tokens" });
});

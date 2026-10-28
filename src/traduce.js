// =====================================================================
//  Cambio 22: textos que vienen del servidor (Bamboo, reglas, errores) en inglés.
//  El servidor sigue guardando su texto de siempre (así la lógica de horas queda
//  igual a Bamboo Check); acá se traduce al mostrarlo cuando la app está en inglés.
//  Lo que escribe una persona (notas, motivos, comentarios) no se toca, salvo las fechas.
// =====================================================================
const MES = { ene: "Jan", feb: "Feb", mar: "Mar", abr: "Apr", may: "May", jun: "Jun", jul: "Jul", ago: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dic: "Dec" };
const DIA = { Lun: "Mon", Mar: "Tue", "Mié": "Wed", Jue: "Thu", Vie: "Fri", "Sáb": "Sat", Dom: "Sun" };
const CLAVE = { lun: "Mon", mar: "Tue", mie: "Wed", jue: "Thu", vie: "Fri", sab: "Sat", dom: "Sun" };
const M = "(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)";
const fecha = (d, m) => `${MES[m]} ${Number(d)}`;
/** "12 oct" → "Oct 12" (también dentro de un texto). */
export const fechasEn = (s) => s
  .replace(new RegExp(`\\b(Lun|Mar|Mié|Jue|Vie|Sáb|Dom) (\\d{1,2}) ${M}\\b`, "g"), (_, w, d, m) => `${DIA[w]} ${fecha(d, m)}`)
  .replace(new RegExp(`\\b(\\d{1,2}) ${M}\\b`, "g"), (_, d, m) => fecha(d, m));

const PAIS = { "México": "Mexico", "Perú": "Peru", "Panamá": "Panama", "República Dominicana": "Dominican Republic", "España": "Spain", "Brasil": "Brazil", "Estados Unidos": "United States" };
const pais = (p) => PAIS[p] ?? p;

// Frases fijas que arma el servidor (en orden: las más largas primero)
const REGLAS = [
  // Errores de la base y de las funciones
  // Registro de cambios de Reglas (lo arma la base al cambiar ciudad o mover un feriado)
  [/^Vuelve a la ciudad por defecto \(antes (.+)\)$/, (_, c) => `Back to the default city (was ${c})`],
  [/^Ciudad: (.+)$/, (_, c) => `City: ${c}`],
  [/^Quitó el cambio de feriado (\d\d\/\d\d) → (\d\d\/\d\d)$/, (_, a, b) => `Removed the holiday change ${a} → ${b}`],
  [/^Feriado (\d\d\/\d\d) movido al (\d\d\/\d\d)(.*)$/, (_, a, b, n) => `Holiday ${a} moved to ${b}${n}`],
  [/^La ciudad "(.+)" no tiene feriado cargado para este país\.$/, (_, c) => `The city "${c}" has no holiday loaded for this country.`],
  [/^El (\d{4}-\d{2}-\d{2}) no es feriado en el país de esta persona\.$/, (_, d) => `${d} is not a holiday in this person's country.`],
  [/^No encontré a "(.+)" en los datos de Bamboo\..*$/, (_, n) => `Couldn't find "${n}" in the Bamboo data. Update from Bamboo and check how the name is spelled.`],
  [/^Acción desconocida: (.*)$/, (_, a) => `Unknown action: ${a}`],
  [/^La contraseña no funciona al entrar: (.*)$/, (_, e) => `The password doesn't work to sign in: ${e}`],
  [/^Se creó el usuario, pero la contraseña no funciona al entrar: (.*)\. Usa "Nueva contraseña"\.$/, (_, e) => `The user was created, but the password doesn't work to sign in: ${e}. Use "New password".`],
  [/^No se pudo guardar el perfil \((.*)\)\. No se creó el acceso; vuelve a intentarlo\.$/, (_, e) => `Couldn't save the profile (${e}). The login wasn't created; try again.`],
  [/^Se (reactivó|bloqueó) el login, pero no se pudo marcar el perfil: (.*)$/, (_, a, e) => `The login was ${a === "reactivó" ? "reactivated" : "blocked"}, but the profile couldn't be updated: ${e}`],
  [/new row violates row-level security policy.*/, () => "You don't have permission to do that."],
  [/^permission denied for table .*/, () => "You don't have permission to do that."],
  // Horas (Bamboo): motivo del día (la frase de feriado movido va antes que la regla general "Feriado X: ")
  [/^Feriado del (\d{1,2} \w{3}) movido al (\d{1,2} \w{3})(?: por ([^:.]+))?(?:: (.*))?\.$/, (_, a, b, q, n) => `Holiday on ${a} moved to ${b}${q ? ` by ${q}` : ""}${n ? `: ${n}` : ""}.`],
  [/^Día no laborable según su horario$/, () => "Non-working day per their schedule"],
  [/Feriado ([^:·]+): /g, (_, p) => `Holiday ${pais(p.trim())}: `],
  [/ \(medio día\)/g, () => " (half day)"],
  [/ \(ciudad elegida en Reglas por ([^,)]+)(, [^)]*)?\)/g, (_, q, f) => ` (city chosen in Rules by ${q}${f ?? ""})`],
  [/ \(movido del (\d{1,2} \w{3})( en Reglas por ([^,:)]+)(, \d{1,2} \w{3})?)?(: ([^)]*))?\)/g, (_, d, _a, q, f, _b, n) => ` (moved from ${d}${q ? ` in Rules by ${q}${f ?? ""}` : ""}${n ? `: ${n}` : ""})`],
  [/\b(\S+) aprobado\b/g, (_, x) => `${x} approved`],
  // Observaciones en Horas
  [/^Feriado regional de (.+?)(?: \(elegido por (.+)\))?\.$/, (_, r, q) => `Regional holiday of ${r}${q ? ` (chosen by ${q})` : ""}.`],
  [/^Registró ([\d.,]+)h el (\d{1,2} \w{3}); se esperaban ([\d.,]+)h \((.*)\)\.$/, (_, h, d, e, m) => `Logged ${h}h on ${d}; ${e}h expected (${m}).`],
  [/^Registró ([\d.,]+)h el (\d{1,2} \w{3}), que era /, (_, h, d) => `Logged ${h}h on ${d}, which was `],
  [/feriado \(([^)]*)\)\. /g, (_, n) => `a holiday (${n}). `],
  [/\bPTO\. Si cambió/g, () => "PTO. Si cambió"],
  [/día no laborable según su horario\. /g, () => "a non-working day per their schedule. "],
  [/Posible cambio de feriado al (\d{1,2} \w{3}) \(0h con comentario: (“.*”)\)\. Valídalo o activa el análisis con IA\./g, (_, d, c) => `Possible holiday swap to ${d} (0h with comment: ${c}). Validate it or turn on AI analysis.`],
  [/Si cambió de día, debería haber otro día en 0 con comentario\./g, () => "If they swapped days, another day should show 0h with a comment."],
  [/^Comentario del (\d{1,2} \w{3}): /, (_, d) => `Comment on ${d}: `],
  [/^Más horas de lo esperado \(([\d.,]+)h\/día\): (.*)\. Total \+([\d.,]+)h en proyecto principal\.$/, (_, h, det, t) => `More hours than expected (${h}h/day): ${det}. Total +${t}h on the main project.`],
  [/^País no detectado en BambooHR: no se aplicaron feriados\.$/, () => "Country not detected in BambooHR: holidays weren't applied."],
  [/^No hay feriados de (.+) cargados en Reglas: no se aplicaron feriados\.$/, (_, p) => `No holidays for ${pais(p)} loaded in Rules: holidays weren't applied.`],
  [/^País no detectado/, () => "Country not detected"],
  [/Horario (lun|mar|mie|jue|vie|sab|dom) a (lun|mar|mie|jue|vie|sab|dom)/, (_, a, b) => `Schedule ${CLAVE[a]} to ${CLAVE[b]}`],
  [/Horario ((?:lun|mar|mie|jue|vie|sab|dom)(?:, (?:lun|mar|mie|jue|vie|sab|dom))*)/, (_, l) => `Schedule ${l.split(", ").map((k) => CLAVE[k]).join(", ")}`],
  // Incidencias automáticas (detalle)
  [/: sin registro/g, () => ": not logged"],
  [/: ([\d.,]+) de ([\d.,]+)h/g, (_, a, b) => `: ${a} of ${b}h`],
  [/h en feriado sin comentario/g, () => "h on a holiday with no comment"],
  [/h en PTO sin comentario/g, () => "h on PTO with no comment"],
  [/h en día libre sin comentario/g, () => "h on a day off with no comment"],
  [/h \(más de ([\d.,]+)h\) sin comentario/g, (_, e) => `h (over ${e}h) with no comment`],
  // Avisos y resumen de la sincronización (solo Gus)
  [/^(\d+) personas · semana: (\d+) con horas pendientes · mes: (\d+)$/, (_, p, s, m) => `${p} people · week: ${s} with pending hours · month: ${m}`],
  [/^No pude leer el PTO aprobado: /, () => "Couldn't read approved PTO: "],
  [/^Vacaciones: /, () => "Time off: "],
  [/: sin permiso en BambooHR$/, () => ": no permission in BambooHR"],
  [/: no se pudo leer a (\d+) de (\d+) personas$/, (_, a, b) => `: couldn't read ${a} of ${b} people`],
  [/^No pude enlazar a (.+?): /, (_, n) => `Couldn't link ${n}: `],
  [/^No pude registrar incidencias: /, () => "Couldn't log incidents: "],
  [/^Países sin feriados cargados: (.*)$/, (_, l) => `Countries without holidays loaded: ${l.split(", ").map(pais).join(", ")}`],
  [/^No hay feriados cargados para (.+)\.$/, (_, l) => `No holidays loaded for ${l}.`],
  [/^Bamboo \(automático\)$/, () => "Bamboo (automatic)"],
  [/^Goal sin título$/, () => "Untitled goal"],
];

/** Frases exactas (errores fijos). */
const EXACTAS = {
  "No se puede cambiar quién creó el pendiente.": "You can't change who created the follow-up.",
  "Para anular una incidencia hay que escribir el motivo.": "To void an incident you must write the reason.",
  "Solo Gus puede cambiar a quién se refiere este registro.": "Only Gus can change who this record is about.",
  "Solo Gus puede cambiar el texto del pendiente o su reunión.": "Only Gus can change the follow-up's text or its meeting.",
  "Solo Gus puede reactivar una incidencia anulada.": "Only Gus can reactivate a voided incident.",
  "Solo el admin puede crear grupos desde Bamboo.": "Only the admin can create groups from Bamboo.",
  "Solo puedes reactivar las incidencias que anulaste tú. Las demás las reactiva Gus.": "You can only reactivate incidents you voided. Gus reactivates the rest.",
  "Solo quien creó el pendiente, el líder de esa persona o Gus pueden cambiar el responsable, la fecha o la prioridad.": "Only the creator, the person's lead or Gus can change the owner, due date or priority.",
  "Esta función es solo para líderes.": "This feature is for leads only.",
  "Falta el secreto BAMBOO_API_KEY en Supabase (Edge Functions → Secrets).": "The BAMBOO_API_KEY secret is missing in Supabase (Edge Functions → Secrets).",
  "Falta el secreto ANTHROPIC_API_KEY en Supabase (Edge Functions → Secrets).": "The ANTHROPIC_API_KEY secret is missing in Supabase (Edge Functions → Secrets).",
  "La contraseña debe tener al menos 8 caracteres.": "The password must be at least 8 characters.",
  "No autorizado.": "Not authorized.",
  "Sesión inválida. Vuelve a iniciar sesión.": "Invalid session. Please sign in again.",
  "Solo Gus (admin) puede usar esta acción.": "Only Gus (admin) can use this action.",
  "Solo Gus puede actualizar desde Bamboo.": "Only Gus can update from Bamboo.",
  "Ya hay una actualización en curso; espera un minuto.": "An update is already running; wait a minute.",
  "Se reflejará en la próxima actualización.": "It will show in the next update.",
  "Bamboo no devolvió el usuario de la API key.": "Bamboo didn't return the API key's user.",
  "Idea no encontrada.": "Idea not found.",
  "La IA no devolvió JSON.": "The AI didn't return JSON.",
  "La IA no devolvió el formato esperado. Vuelve a intentarlo.": "The AI didn't return the expected format. Try again.",
  "La reunión no tiene texto.": "The meeting has no text.",
  "La reunión no tiene transcripción o notas.": "The meeting has no transcript or notes.",
  "No encontré personas a tu cargo en Bamboo (revisa que el campo Supervisor esté visible).": "No people reporting to you were found in Bamboo (check that the Supervisor field is visible).",
  "Persona no encontrada o sin acceso.": "Person not found or no access.",
  "Persona no encontrada.": "Person not found.",
  "Reunión no encontrada.": "Meeting not found.",
  "Revisión no encontrada.": "Review not found.",
  "Solo puedes analizar reuniones que subiste tú.": "You can only analyze meetings you uploaded.",
  "Solo puedes pedir recomendaciones de reuniones que subiste tú.": "You can only ask for recommendations on meetings you uploaded.",
  "Correo inválido.": "Invalid email.",
  "Ya existe un usuario con este correo.": "A user with this email already exists.",
  "No puedes desactivar tu propio acceso.": "You can't disable your own access.",
  "Usuario no encontrado.": "User not found.",
  "No se puede desactivar a un admin.": "An admin can't be disabled.",
  "Tu acceso está desactivado.": "Your access is disabled.",
};

/** Traduce un texto del servidor al inglés (si la app está en inglés). */
export function deServidor(s, lang) {
  if (lang !== "en" || s == null || s === "") return s;
  let out = String(s);
  if (EXACTAS[out]) return EXACTAS[out];
  for (const [re, fn] of REGLAS) out = out.replace(re, fn);
  return fechasEn(out);
}

// ---------------------------------------------------------------------
// Cambio 24: ¿el texto está en español? (para pedir su traducción solo cuando hace falta)
// ---------------------------------------------------------------------
const PAL_ES = new Set(("de la el que en los las con para por del se una un es su al lo como más pero sus le ya fue este ha porque esta entre cuando muy sin sobre también " +
  "hasta hay donde quien desde todo nos durante todos uno les ni otros ese eso ante ellos esto antes algunos qué unos otro otras otra tanto esa estos mucho " +
  "nada muchos cual poco ella estar estas algunas algo hizo hace tiene debe puede bien mejor equipo cliente caso casos semana día días mes reunión tarea " +
  "pendiente revisar hablar avisar entrega trabajo registro horas aplicó acordamos falta faltan nota privada").split(" "));
export function pareceEspanol(s) {
  if (!s || typeof s !== "string") return false;
  const txt = s.toLowerCase();
  if (/[áéíóúñ¿¡]/.test(txt)) return true;
  const pals = txt.match(/[a-záéíóúñü]+/g) ?? [];
  if (!pals.length) return false;
  const n = pals.filter((w) => PAL_ES.has(w)).length;
  if (pals.length <= 6) return n >= 1 || pals.some((w) => /(ción|ciones|dad|dades|mente|ismo|ivo|iva|ado|ada|ido|ida)$/.test(w));
  return n >= 2 && n / pals.length >= 0.15;
}

/**
 * Feed simulado. En cada carga (o cuando cambian las reglas en la BD) envía los posts, las reglas activas
 * y las correcciones del usuario a la API del CFP; recibe la certeza por post×regla y difumina según el umbral.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hash = (t) => { let h = 5381; for (const c of t) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(16); };
const slug = (n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "usuario";

let evaluacion = null, pendiente = false, errorApi = null, turno = 0, decisiones = {};
const revelados = new Set();
const reglasActivas = () => ModerAIStorage.getReglas().filter((r) => r.activa);
const todos = () => ModerAIStorage.getPostsUsuario().concat(ModerAIPosts);

document.addEventListener("DOMContentLoaded", () => { wirePopup(); wirePosts(); wireComposer(); evaluar(); });
window.addEventListener("storage", (e) => {
  if (e.key === "regla_filtro") evaluar();      // cambiaste prompts en Configuración -> vuelve a consultar al modelo
  else if (e.key === "usuario_config") render();
});

async function evaluar(silencioso = false) {
  const reglas = reglasActivas(), mio = ++turno;
  errorApi = null;
  if (!reglas.length) { evaluacion = null; pendiente = false; return render(); }
  if (!silencioso) evaluacion = null;
  pendiente = !silencioso;
  render();
  try {
    const ids = new Set(reglas.map((r) => r.id_regla));
    const corr = ModerAIStorage.getCorrecciones().filter((c) => ids.has(c.id_regla));
    const res = await ModerAIApi.evaluar(todos(), reglas, corr);
    if (mio !== turno) return;
    evaluacion = res;
  } catch (e) { if (mio !== turno) return; errorApi = e.message; }
  pendiente = false;
  render();
}

function render() {
  const reglas = reglasActivas(), nivel = ModerAIStorage.getUsuarioConfig().nivel_sensibilidad;
  const reportados = new Set(ModerAIStorage.getHistorial().filter((h) => h.error_reportado).map((h) => h.id_post));
  const filas = [];
  let bloqueados = 0, analizando = 0;
  decisiones = {};

  $("posts").innerHTML = todos().map((p) => {
    const scores = {}, det = {};
    (evaluacion?.resultados || []).forEach((r) => { if (r.id_post === p.id) { scores[r.id_regla] = r.certeza; det[r.id_regla] = r; } });
    const hay = Object.keys(scores).length > 0;
    const espera = reglas.length > 0 && !errorApi && !hay;          // aún sin dictamen: se muestra difuminado
    const d = !errorApi && hay ? ModerAIDecision.decidir(scores, reglas, nivel) : null;
    const reportado = reportados.has(p.id);
    const difuminar = espera || (d && d.difuminar && !reportado);
    decisiones[p.id] = d;
    if (espera) analizando++;
    if (d) {
      if (difuminar) bloqueados++;
      filas.push({ id_historial: p.id, id_usuario: ModerAIStorage.USER_ID, id_regla: d.regla.id_regla, id_post: p.id,
        hash_contenido: hash(p.texto), porcentaje_certeza: d.certeza, accion_aplicada: difuminar ? "DIFUMINADO" : "VISIBLE",
        error_reportado: 0, fecha_evaluacion: ModerAIStorage.hoy() });
    }
    const oculto = difuminar && !revelados.has(p.id);
    let overlay = "", barra = "", ia = "";
    if (oculto && espera) overlay = `<div class="overlay"><div class="card"><h3>Analizando con ModerAI…</h3><p>El post se muestra al terminar el análisis.</p></div></div>`;
    else if (oculto) overlay = `<div class="overlay"><div class="card"><span class="badge">${Math.round(d.certeza)}% ${ModerAIDecision.ETIQUETA[d.regla.categoria] || "Regla"}</span><h3>Contenido difuminado</h3><p>Coincide con tu regla: "${esc(d.regla.prompt)}"</p><button class="b p" data-a="show" data-i="${p.id}">Mostrar contenido</button></div></div>`;
    else if (difuminar) barra = `<div class="bar"><span>Este post estaba difuminado (${Math.round(d.certeza)}%).</span><button class="b d" data-a="rep" data-i="${p.id}">Reportar error</button></div>`;
    if (d) {
      const x = det[d.regla.id_regla] || {};
      const aj = x.ajuste ? ` ${x.ajuste > 0 ? "+" : "−"}${Math.abs(x.ajuste)} por tus correcciones` : "";
      const etq = (ModerAIDecision.ETIQUETA[d.regla.categoria] || "coincidencia").toLowerCase();
      ia = `<div class="ia ${difuminar ? "si" : ""}"><span>IA: ${d.certeza}% (modelo ${x.base ?? d.certeza}%${aj}) · umbral ${d.umbral}% → ${reportado ? "reportado como falso positivo" : d.difuminar ? "difumina" : "visible"}</span>${difuminar ? "" : `<button class="b d s" data-a="mark" data-i="${p.id}">Marcar como ${etq}</button>`}</div>`;
    }
    return `<article class="post"><div class="head"><div class="avatar">${esc(p.nombre[0])}</div><div class="name">${esc(p.nombre)} <span class="meta">@${esc(p.usuario)} · ${p.hora}</span></div></div>
      <div class="body ${oculto ? "oculto" : ""}"><div class="content ${oculto ? "blur" : ""}">${esc(p.texto)}</div>${overlay}</div>${barra}${ia}</article>`;
  }).join("");

  if (evaluacion && !errorApi) ModerAIStorage.setHistorialHoy(filas);
  $("extBadge").textContent = ModerAIStorage.getBloqueosHoy();

  const e = $("estado"), nc = ModerAIStorage.getCorrecciones().length;
  e.classList.toggle("err", !!errorApi);
  if (errorApi) e.textContent = `No se pudo conectar con el modelo (${errorApi}). Inicia la API con: uvicorn api.main:app --port 8000 y abre http://localhost:8000/src/feed/feed.html. Mostrando el feed sin filtrar.`;
  else if (!reglas.length) e.textContent = `Sin reglas activas: no se filtra nada. Crea una desde el popup → "Gestionar reglas".`;
  else if (analizando) e.textContent = `Consultando al modelo: ${analizando} post(s) × ${reglas.length} regla(s)…`;
  else e.textContent = `Modelo: ${evaluacion.modelo} · ${evaluacion.ms} ms (${evaluacion.en_cache} en caché) · ${bloqueados} de ${todos().length} posts difuminados · sensibilidad ${nivel}% · ${nc} corrección(es) aprendida(s)`;
}

function wirePosts() {
  $("posts").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const id = +b.dataset.i, d = decisiones[id], p = todos().find((x) => x.id === id);
    if (b.dataset.a === "show") { revelados.add(id); return render(); }
    if (!d || !p) return;
    const corr = { id_regla: d.regla.id_regla, id_post: id, texto: p.texto };
    if (b.dataset.a === "rep") { ModerAIStorage.marcarError(id); ModerAIStorage.addCorreccion({ ...corr, etiqueta: 0 }); }
    if (b.dataset.a === "mark") { ModerAIStorage.quitarError(id); ModerAIStorage.addCorreccion({ ...corr, etiqueta: 1 }); }
    render();
    evaluar(true);   // el modelo vuelve a puntuar todo el feed con la corrección aprendida
  });
}

function wireComposer() {
  const t = $("cTexto");
  t.addEventListener("input", () => { $("cCuenta").textContent = `${t.value.length}/280`; });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const nombre = $("cNombre").value.trim(), texto = t.value.trim();
    if (!nombre || !texto) return;
    ModerAIStorage.addPostUsuario({ id: Date.now(), nombre, usuario: slug(nombre), hora: "ahora", texto });
    t.value = ""; $("cCuenta").textContent = "0/280";
    evaluar(true);   // el post nuevo entra difuminado hasta que el modelo lo dictamine
  });
}

/* Popup de la "extensión": el iframe carga el popup real del proyecto */
function wirePopup() {
  const btn = $("extBtn"), pop = $("extPop"), frame = $("popFrame");
  const abrir = (v) => {
    pop.hidden = !v; btn.setAttribute("aria-expanded", v);
    if (v) frame.contentWindow?.postMessage({ type: "moderai:medir" }, "*");   // el iframe oculto medía 0px: se vuelve a medir al abrir
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); abrir(pop.hidden); });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) abrir(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") abrir(false); });
  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    if (e.data?.type === "moderai:resize" && e.data.height > 50) frame.style.height = e.data.height + "px";
    if (e.data?.type === "moderai:nivel") render();   // cambió la sensibilidad: se re-decide sin volver a llamar al modelo
  });
}

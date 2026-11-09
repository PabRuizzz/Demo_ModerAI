/**
 * Content script para X (x.com): detecta los posts del timeline, los difumina al instante, pide el dictamen
 * a la API (vía service worker) y deja el post difuminado, visible o con opción de reportar.
 * Los selectores de X cambian sin aviso: si dejan de funcionar, revísalos con las herramientas de desarrollo.
 */
(() => {
  // MODO PRUEBA: difumina sin reglas ni API, para comprobar que el difuminado funciona en X.
  // PALABRA_PRUEBA vacía = difumina todos los posts con texto; con una palabra = solo los que la contienen.
  // Cuando quieras conectar el modelo: MODO_PRUEBA = false.
  const MODO_PRUEBA = false;
  const PALABRA_PRUEBA = "";

  const SEL_POST = 'article[data-testid="tweet"]';
  const SEL_TEXTO = '[data-testid="tweetText"]';
  const ETQ = ModerAIDecision.ETIQUETA;
  const CSS = `
    :host{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a}
    .card{background:#fff;border:1.5px solid #1a1a1a;border-radius:8px;padding:10px 14px;max-width:270px;width:calc(100% - 16px);text-align:center;box-shadow:3px 3px 0 #1a1a1a}
    h3{font-size:13.5px;margin:4px 0 2px} p{font-size:11.5px;color:#666;margin:0 0 8px}
    .badge{display:inline-block;font-size:12px;font-weight:600;background:#1a1a1a;color:#fff;padding:2px 9px;border-radius:999px}
    button{font:inherit;font-size:12.5px;padding:6px 12px;border-radius:6px;cursor:pointer;border:1.5px solid #1a1a1a;background:#fff;color:#1a1a1a}
    button.p{background:#1a1a1a;color:#fff;width:100%}
    .barra{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 14px;background:#fff;border-top:1px dashed #1a1a1a;font-size:12px;color:#666}
    button.d{border-style:dashed}
    @media (max-width:340px){.card{padding:8px 10px}p{display:none}}`;

  const posts = new Map();                  // article -> { id, texto, scores, revelado, reportado, host }
  let reglas = [], nivel = 70, seq = 0, cola = new Set(), timer = null;

  const hashNum = (t) => { let h = 5381; for (const c of t) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h; };
  const activas = () => reglas.filter((r) => r.activa);

  async function cargarConfig() {
    const c = await chrome.storage.local.get(["regla_filtro", "usuario_config"]);
    reglas = c.regla_filtro || [];
    nivel = c.usuario_config?.nivel_sensibilidad ?? 70;
  }

  /* ---- detección ---- */
  function escanear() {
    if (!MODO_PRUEBA && !activas().length) return;
    document.querySelectorAll(SEL_POST).forEach((a) => {
      const texto = a.querySelector(SEL_TEXTO)?.innerText.trim();
      if (!texto) return;                                   // posts sin texto: por ahora no se evalúan
      const p = posts.get(a);
      if (p && p.texto === texto) return;
      if (p) limpiar(a, p);                                 // X reutiliza nodos: el contenido cambió
      posts.set(a, { id: ++seq, texto, scores: null, revelado: false, reportado: false, host: null });
      if (MODO_PRUEBA) {
        const np = posts.get(a);
        np.scores = {};
        np.d = { difuminar: true, certeza: 91, regla: { id_regla: 0, prompt: "Modo prueba (sin API)", categoria: "SPOILER" } };
        if (!PALABRA_PRUEBA || texto.toLowerCase().includes(PALABRA_PRUEBA.toLowerCase())) pintar(a, "cartel");
        return;
      }
      pintar(a, "analizando");                              // se difumina ANTES de saber el resultado
      cola.add(a);
    });
    if (cola.size && !timer) timer = setTimeout(enviar, 200);
  }

  async function enviar() {
    timer = null;
    const arts = [...cola].filter((a) => posts.has(a)); cola.clear();
    if (!arts.length) return;
    let espera;
    const liberar = () => arts.forEach((a) => posts.has(a) && limpiar(a, posts.get(a)));
    try {
    const rs = activas();
    if (!rs.length) { liberar(); return; }
    const ids = new Set(rs.map((r) => r.id_regla));
    const corr = ((await chrome.storage.local.get("correccion_usuario")).correccion_usuario || []).filter((c) => ids.has(c.id_regla));
    const payload = {
      posts: arts.map((a) => ({ id: posts.get(a).id, texto: posts.get(a).texto })),
      reglas: rs.map(({ id_regla, prompt, categoria }) => ({ id_regla, prompt, categoria })),
      correcciones: corr.map(({ id_regla, texto, etiqueta }) => ({ id_regla, texto, etiqueta }))
    };
    let res;
    try {
      res = await Promise.race([
        chrome.runtime.sendMessage({ type: "evaluar", payload }),
        new Promise((_, reject) => {
          espera = setTimeout(() => reject(new Error("El modelo no respondió en 30 segundos")), 30000);
        })
      ]);
    } catch (error) {
      res = { ok: false, error: error.message };
    }
    if (!res?.ok) { console.warn("[ModerAI] sin modelo:", res?.error); arts.forEach((a) => posts.has(a) && limpiar(a, posts.get(a))); return; } // si falla, se muestra el post
    if (!Array.isArray(res.data?.resultados)) throw new Error("Respuesta de evaluación inválida");
    const porId = {};
    res.data.resultados.forEach((r) => { (porId[r.id_post] ||= {})[r.id_regla] = r.certeza; });
    arts.forEach((a) => { const p = posts.get(a); if (p) { p.scores = porId[p.id] || {}; decidir(a); } });
    await guardarHistorial();
    } catch (error) {
      console.error("[ModerAI] error al evaluar publicaciones:", error);
      liberar();
    } finally {
      clearTimeout(espera);
    }
  }

  /* ---- decisión y pintado ---- */
  function decidir(a) {
    const p = posts.get(a);
    if (!p?.scores) return;
    if (MODO_PRUEBA) return p.reportado ? limpiar(a, p) : pintar(a, p.revelado ? "barra" : "cartel");
    const d = ModerAIDecision.decidir(p.scores, activas(), nivel);
    p.d = d;
    if (!d || !d.difuminar || p.reportado) return limpiar(a, p);
    pintar(a, p.revelado ? "barra" : "cartel");
  }

  function limpiar(a, p) {
    const inner = a.firstElementChild;
    if (inner) { inner.style.filter = ""; inner.style.pointerEvents = ""; }
    p.host?.remove(); p.host = null;
  }

  function pintar(a, estado) {
    const p = posts.get(a), inner = a.firstElementChild, d = p.d;
    if (!inner) return;
    if (!p.host) {
      const host = document.createElement("div");
      host.addEventListener("click", (e) => e.stopPropagation());   // que X no abra el post al hacer clic en el cartel
      const root = host.attachShadow({ mode: "open" });
      const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS);    // no depende del CSP de la página
      root.adoptedStyleSheets = [sheet];
      if (getComputedStyle(a).position === "static") a.style.position = "relative";
      a.appendChild(host);
      p.host = host;
    }
    const root = p.host.shadowRoot, barra = estado === "barra";
    inner.style.filter = barra ? "" : "blur(10px)";
    inner.style.pointerEvents = barra ? "" : "none";
    p.host.style.cssText = barra ? "position:absolute;left:0;right:0;bottom:0;z-index:9"
      : "position:absolute;inset:0;z-index:9;display:grid;place-items:center";
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    if (estado === "analizando") root.innerHTML = `<div class="card"><h3>Analizando con ModerAI…</h3></div>`;
    else if (barra) root.innerHTML = `<div class="barra"><span>Estaba difuminado (${Math.round(d.certeza)}%).</span><button class="d" id="rep">Reportar error</button></div>`;
    else root.innerHTML = `<div class="card"><span class="badge">${Math.round(d.certeza)}% ${ETQ[d.regla.categoria] || "Regla"}</span><h3>Contenido difuminado</h3><p>Coincide con tu regla: "${esc(d.regla.prompt)}"</p><button class="p" id="show">Mostrar contenido</button></div>`;
    root.getElementById("show")?.addEventListener("click", () => { p.revelado = true; decidir(a); });
    root.getElementById("rep")?.addEventListener("click", () => reportar(a));
  }

  /* ---- aprendizaje: "Reportar error" = corrección con etiqueta 0 ---- */
  async function reportar(a) {
    const p = posts.get(a);
    p.reportado = true; decidir(a);
    if (MODO_PRUEBA) return;                                 // en modo prueba no se guarda ni se llama a la API
    const { correccion_usuario = [] } = await chrome.storage.local.get("correccion_usuario");
    const resto = correccion_usuario.filter((c) => !(c.id_regla === p.d.regla.id_regla && c.texto === p.texto));
    await chrome.storage.local.set({ correccion_usuario: resto.concat({ id_regla: p.d.regla.id_regla, id_post: hashNum(p.texto), texto: p.texto, etiqueta: 0, fecha: new Date().toISOString().slice(0, 10) }) });
    posts.forEach((_, art) => cola.add(art));                // la API vuelve a puntuar todo con la corrección
    if (!timer) timer = setTimeout(enviar, 50);
  }

  async function guardarHistorial() {
    const hoy = new Date().toISOString().slice(0, 10);
    const filas = [];
    posts.forEach((p) => {
      if (!p.d) return;
      const dif = p.d.difuminar && !p.reportado;
      filas.push({ id_historial: hashNum(p.texto), id_usuario: "usr_local_123", id_regla: p.d.regla.id_regla, id_post: hashNum(p.texto),
        hash_contenido: hashNum(p.texto).toString(16), porcentaje_certeza: p.d.certeza,
        accion_aplicada: p.reportado ? "REPORTE_FALSO_POSITIVO" : dif ? "DIFUMINADO" : "VISIBLE", error_reportado: p.reportado ? 1 : 0, fecha_evaluacion: hoy });
    });
    const claves = new Set(filas.map((f) => f.id_post));
    const { historial_moderacion = [] } = await chrome.storage.local.get("historial_moderacion");
    await chrome.storage.local.set({ historial_moderacion: historial_moderacion.filter((h) => !claves.has(h.id_post)).concat(filas) });
  }

  /* ---- arranque ---- */
  chrome.storage.onChanged.addListener((cambios) => {
    if (MODO_PRUEBA) return;
    if (cambios.regla_filtro) {                              // cambiaste prompts: se vuelve a consultar al modelo
      reglas = cambios.regla_filtro.newValue || [];
      if (!activas().length) { posts.forEach((p, a) => limpiar(a, p)); posts.clear(); return; }
      posts.forEach((_, a) => cola.add(a)); escanear();
      if (!timer) timer = setTimeout(enviar, 50);
    }
    if (cambios.usuario_config) { nivel = cambios.usuario_config.newValue?.nivel_sensibilidad ?? 70; posts.forEach((_, a) => decidir(a)); }
  });

  async function iniciar() {
    try {
      const result = await chrome.runtime.sendMessage({ type: "reglas_listar" });
      if (!result?.ok) console.warn("[ModerAI] usando reglas locales: servidor no disponible");
    } catch (error) {
      console.warn("[ModerAI] usando reglas locales:", error.message);
    }
    await cargarConfig();
    escanear();
    let debounce;
    new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(escanear, 250); })
      .observe(document.body, { childList: true, subtree: true });
  }
  iniciar();
})();

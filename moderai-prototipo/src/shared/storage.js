/**
 * storage.js
 * Simula la tabla `regla_filtro` (y `usuario_config`) del esquema db/schema.sql
 * usando localStorage, para que el Task Flow 1 se pueda recorrer sin backend.
 * Cada fila que aquí se guarda es exactamente la que se vería en la tabla real.
 */
const ModerAIStorage = (() => {
  const USER_ID = "usr_local_123";

  function get(key, fallback) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }
  function set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    // En la extensión: espejo en chrome.storage.local, que sí leen el content script y el service worker
    try { if (typeof chrome !== "undefined" && chrome.storage?.local) chrome.storage.local.set({ [key]: value }); } catch (e) {}
  }

  function getUsuarioConfig() {
    return get("usuario_config", {
      id_usuario: USER_ID,
      activo: 1,
      nivel_sensibilidad: 70,
      pin_hash: null,
      nip_activo: 0,
      intentos_fallidos: 0,
      bloqueado_hasta: null
    });
  }
  function setUsuarioConfig(cfg) {
    set("usuario_config", cfg);
  }

  // Fila con EXACTAMENTE las columnas de la tabla regla_filtro (db/schema.sql)
  function getReglas() {
    return get("regla_filtro", []);
  }
  function addRegla(row) {
    const reglas = getReglas();
    reglas.push(row);
    set("regla_filtro", reglas);
    return row;
  }

  async function reglasRemotas(type, payload) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.ok) throw new Error(response?.error || "No se pudo conectar con el servidor");
    return response.data;
  }
  async function sincronizarReglas() {
    if (location.protocol !== "chrome-extension:") return;
    const data = await reglasRemotas("reglas_listar");
    if (!localStorage.getItem("reglas_locales_respaldo")) {
      localStorage.setItem("reglas_locales_respaldo", JSON.stringify(getReglas()));
    }
    localStorage.setItem("regla_filtro", JSON.stringify(data.reglas));
    const cfg = getUsuarioConfig();
    cfg.id_usuario = data.id_usuario;
    setUsuarioConfig(cfg);
  }
  async function guardarRegla(row) {
    if (location.protocol !== "chrome-extension:") return addRegla(row);
    const saved = await reglasRemotas("reglas_crear", {
      prompt: row.prompt, categoria: row.categoria, sensibilidad: row.sensibilidad
    });
    const rules = getReglas().filter(r => r.id_usuario === saved.id_usuario && r.id_regla !== saved.id_regla);
    localStorage.setItem("regla_filtro", JSON.stringify(rules.concat(saved)));
    return saved;
  }

  async function hashPin(pin) {
    const enc = new TextEncoder().encode(`moderai:${pin}`);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // historial_moderacion: una fila por post evaluado hoy (se reemplaza al reevaluar; conserva los reportes del usuario)
  const hoy = () => new Date().toISOString().slice(0, 10);
  function getHistorial() { return get("historial_moderacion", []); }
  function setHistorialHoy(filas) {
    const previo = getHistorial();
    const rep = new Set(previo.filter((h) => h.error_reportado).map((h) => h.id_post));
    const nuevas = filas.map((f) => (rep.has(f.id_post) ? { ...f, accion_aplicada: "REPORTE_FALSO_POSITIVO", error_reportado: 1 } : f));
    set("historial_moderacion", previo.filter((h) => h.fecha_evaluacion !== hoy()).concat(nuevas));
  }
  function marcarError(idPost) {
    set("historial_moderacion", getHistorial().map((h) => (h.id_post === idPost ? { ...h, accion_aplicada: "REPORTE_FALSO_POSITIVO", error_reportado: 1 } : h)));
  }
  function quitarError(idPost) {
    set("historial_moderacion", getHistorial().map((h) => (h.id_post === idPost ? { ...h, accion_aplicada: "VISIBLE", error_reportado: 0 } : h)));
  }
  // Posts publicados desde el feed (sin cuenta: solo nombre y texto)
  function getPostsUsuario() { return get("posts_usuario", []); }
  function addPostUsuario(p) { set("posts_usuario", [p, ...getPostsUsuario()].slice(0, 30)); return p; }
  // correccion_usuario: lo que el modelo "aprende" (etiqueta 0 = no pertenece a la regla, 1 = sí pertenece)
  function getCorrecciones() { return get("correccion_usuario", []); }
  function addCorreccion(c) {
    const resto = getCorrecciones().filter((x) => !(x.id_post === c.id_post && x.id_regla === c.id_regla));
    set("correccion_usuario", resto.concat({ ...c, fecha: hoy() }));
  }
  function getBloqueosHoy() {
    return getHistorial().filter((h) => h.fecha_evaluacion === hoy() && h.accion_aplicada === "DIFUMINADO").length;
  }

  function resetAll() {
    try { if (typeof chrome !== "undefined" && chrome.storage?.local) chrome.storage.local.remove(["regla_filtro", "usuario_config", "historial_moderacion", "posts_usuario", "correccion_usuario"]); } catch (e) {}
    localStorage.removeItem("regla_filtro");
    localStorage.removeItem("usuario_config");
    localStorage.removeItem("historial_moderacion");
    localStorage.removeItem("posts_usuario");
    localStorage.removeItem("correccion_usuario");
  }

  return { USER_ID, getUsuarioConfig, setUsuarioConfig, getReglas, addRegla, sincronizarReglas, guardarRegla, hashPin, resetAll, hoy, getHistorial, setHistorialHoy, marcarError, quitarError, getPostsUsuario, addPostUsuario, getCorrecciones, addCorreccion, getBloqueosHoy };
})();

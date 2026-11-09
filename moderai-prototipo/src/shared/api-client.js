/** Cliente de la API FastAPI (CFP). Funciona al abrir el prototipo desde http://localhost:8000 */
const ModerAIApi = (() => {
  const BASE = location.protocol.startsWith("http") ? "" : "http://localhost:8000";
  async function evaluar(posts, reglas, correcciones = []) {
    const payload = {
        posts: posts.map((p) => ({ id: p.id, texto: p.texto })),
        reglas: reglas.map((r) => ({ id_regla: r.id_regla, prompt: r.prompt, categoria: r.categoria })),
        correcciones: correcciones.map((c) => ({ id_regla: c.id_regla, texto: c.texto, etiqueta: c.etiqueta }))
    };
    if (location.protocol === "chrome-extension:") {
      const response = await chrome.runtime.sendMessage({ type: "evaluar", payload });
      if (!response?.ok) throw new Error(response?.error || "API no disponible");
      return response.data;
    }
    const r = await fetch(`${BASE}/api/evaluar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }
  // Paso "Sincroniza prompt con API" del Task Flow 1: evalúa la regla nueva y deja los scores en caché del servidor.
  async function syncPromptWithAPI(regla) {
    try { await evaluar(ModerAIPosts, [regla]); return { status: "ok", id_regla: regla.id_regla }; }
    catch (e) { return { status: "offline", id_regla: regla.id_regla }; }
  }
  return { evaluar, syncPromptWithAPI };
})();

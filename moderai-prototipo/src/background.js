// Service worker: único lugar que habla con la API (el content script queda sujeto al CORS de la página).
// Cuando el servidor esté en Azure: cambiar API_BASE por "https://TU-DOMINIO" y agregarlo a host_permissions del manifest.
const API_BASE = "http://localhost:8000";
let identityPromise;
let rulesQueue = Promise.resolve();

async function request(path, method, payload, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(25000),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  if (!response.ok) throw new Error(`API ${response.status}: no se pudo completar la operación`);
  return response.json();
}

function identity() {
  if (!identityPromise) identityPromise = (async () => {
    let { moderai_token } = await chrome.storage.local.get("moderai_token");
    if (!moderai_token) {
      moderai_token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
      await chrome.storage.local.set({ moderai_token });
    }
    await request("/api/instalacion", "POST", undefined, moderai_token);
    return moderai_token;
  })().catch(error => { identityPromise = null; throw error; });
  return identityPromise;
}

async function rulesMessage(msg) {
  const token = await identity();
  if (msg.type === "reglas_crear") {
    const saved = await request("/api/reglas", "POST", msg.payload, token);
    const { regla_filtro = [] } = await chrome.storage.local.get("regla_filtro");
    await chrome.storage.local.set({ regla_filtro: regla_filtro.filter(r => r.id_usuario === saved.id_usuario && r.id_regla !== saved.id_regla).concat(saved) });
    return saved;
  }
  const data = await request("/api/reglas", "GET", undefined, token);
  const previous = await chrome.storage.local.get(["regla_filtro", "reglas_locales_respaldo"]);
  if (!previous.reglas_locales_respaldo && previous.regla_filtro?.some(r => r.id_usuario === "usr_local_123")) {
    await chrome.storage.local.set({ reglas_locales_respaldo: previous.regla_filtro });
  }
  await chrome.storage.local.set({ regla_filtro: data.reglas });
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (["reglas_listar", "reglas_crear"].includes(msg?.type)) {
    const operation = rulesQueue.then(() => rulesMessage(msg));
    rulesQueue = operation.catch(() => {});
    operation.then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (msg?.type !== "evaluar") return;
  fetch(`${API_BASE}/api/evaluar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify(msg.payload)
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`API ${r.status}`))))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true; // la respuesta es asíncrona
});

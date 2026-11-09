const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enIframe = window.parent !== window;

function pintar() {
  const activas = ModerAIStorage.getReglas().filter((r) => r.activa);
  $("reglasActivas").textContent = activas.length;
  $("bloqueosHoy").textContent = ModerAIStorage.getBloqueosHoy();
  if (document.activeElement !== $("nivel")) {
    const n = ModerAIStorage.getUsuarioConfig().nivel_sensibilidad;
    $("nivel").value = n; $("nivelVal").textContent = `${n}%`;
  }
  const ultimas = activas.slice(-4).reverse();
  $("listaReglasRapida").innerHTML = ultimas.length
    ? ultimas.map((r) => `<li>${esc(r.prompt)}</li>`).join("")
    : '<li class="vacio">Aún no has creado reglas.</li>';
  avisarAltura();
}
function avisarAltura() {
  if (!enIframe) return;
  requestAnimationFrame(() => {
    const h = document.body.offsetHeight;
    if (h > 50) window.parent.postMessage({ type: "moderai:resize", height: h }, "*");
  });
}

// En la extensión real, el content script guarda el historial en chrome.storage.local
function traerHistorial() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  chrome.storage.local.get(["historial_moderacion"], (r) => {
    if (r.historial_moderacion) localStorage.setItem("historial_moderacion", JSON.stringify(r.historial_moderacion));
    pintar();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  pintar();
  traerHistorial();
  ModerAIStorage.sincronizarReglas().then(pintar).catch(() => {});
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) chrome.storage.onChanged.addListener(traerHistorial);
  window.addEventListener("storage", pintar);
  window.addEventListener("message", (e) => { if (e.data?.type === "moderai:medir") avisarAltura(); });   // el feed actualiza el historial -> "bloqueos hoy" en vivo

  $("nivel").addEventListener("input", () => {
    const cfg = ModerAIStorage.getUsuarioConfig();
    cfg.nivel_sensibilidad = +$("nivel").value;
    ModerAIStorage.setUsuarioConfig(cfg);
    $("nivelVal").textContent = `${cfg.nivel_sensibilidad}%`;
    if (enIframe) window.parent.postMessage({ type: "moderai:nivel" }, "*");
  });

  // Task Flow 1, paso 2: (U) Clic "Gestionar Reglas" -> (S) Abre Options
  $("btnGestionarReglas").addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
    else if (enIframe) window.open("../options/options.html", "_blank");
    else window.location.href = "../options/options.html";
  });
});

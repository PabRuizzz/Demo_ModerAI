/**
 * options.js — Task Flow 1 sobre la interfaz Bootstrap basada en el wireframe:
 * Escribe prompt -> Guardar -> ¿NIP activado? -> Guarda en regla_filtro
 * -> Sincroniza con API (BETO) -> Notifica -> se refleja en la tabla y en la BD en vivo.
 */
let pendingRegla = null;
let lastInsertedId = null;
let bsModalNip = null;
let bsToast = null;
let guardandoRegla = false;

document.addEventListener("DOMContentLoaded", () => {
  bsModalNip = new bootstrap.Modal(document.getElementById("modalNip"));
  bsToast = new bootstrap.Toast(document.getElementById("toast"), { delay: 4000 });

  wireTabs();
  renderReglas();
  renderDB();
  renderJohnsonBox();
  wireSeguridad();
  wireForm();
  wireModalNip();

  if (location.protocol === "chrome-extension:") {
    document.getElementById("btnReset").textContent = "Limpiar datos locales";
    ModerAIStorage.sincronizarReglas().then(() => {
      renderReglas(); renderDB(); renderJohnsonBox();
    }).catch(() => showToast("No se pudieron recuperar las reglas de MySQL. Revisa FastAPI y el túnel SSH; se muestra la copia local.", true));
  }

  document.getElementById("btnReset").addEventListener("click", () => {
    if (location.protocol === "chrome-extension:" && !confirm("Se limpiarán los datos locales. Las reglas de MySQL se recuperarán al recargar; no se borrarán del servidor.")) return;
    ModerAIStorage.resetAll();
    location.reload();
  });
});

/* -------- Navegación por tabs (sitemap: Dashboard de Opciones) -------- */
function wireTabs() {
  document.querySelectorAll(".tab-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-card").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("d-none"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.remove("d-none");
    });
  });
}

/* -------- Johnson Box: resumen escaneable -------- */
function renderJohnsonBox() {
  const reglas = ModerAIStorage.getReglas();
  const activas = reglas.filter((r) => r.activa);
  document.getElementById("statReglas").textContent = activas.length;

  const pesos = { Baja: 30, Normal: 70, Alta: 95 };
  const promedio = activas.length
    ? Math.round(activas.reduce((sum, r) => sum + (pesos[r.sensibilidad] || 70), 0) / activas.length)
    : 70;
  document.getElementById("statSensibilidad").textContent = `${promedio}%`;
  document.getElementById("statBloqueos").textContent = ModerAIStorage.getBloqueosHoy();
}

/* -------- Listado de reglas (tabla desktop/tablet + tarjetas apiladas en móvil) -------- */
function renderReglas() {
  const reglas = ModerAIStorage.getReglas().slice().reverse();
  const tbody = document.getElementById("tablaReglasBody");
  const mobile = document.getElementById("listaReglasMobile");
  tbody.innerHTML = "";
  mobile.innerHTML = "";
  document.getElementById("reglasVacio").classList.toggle("d-none", reglas.length > 0);

  reglas.forEach((r) => {
    const estado = r.activa ? '<span class="badge text-bg-light border">Activa</span>' : '<span class="badge text-bg-light border">Inactiva</span>';
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(r.prompt)}</td><td>${r.categoria}</td><td>${r.sensibilidad}</td><td>${estado}</td>`;
    tbody.appendChild(tr);

    const card = document.createElement("div");
    card.className = "regla-mobile-card";
    card.innerHTML = `<div>${escapeHtml(r.prompt)}</div><div class="meta">${r.categoria} · Sensibilidad ${r.sensibilidad} · ${r.activa ? "Activa" : "Inactiva"}</div>`;
    mobile.appendChild(card);
  });
}

/* -------- Vista en vivo de la tabla regla_filtro -------- */
function renderDB() {
  const reglas = ModerAIStorage.getReglas();
  const tbody = document.querySelector("#tablaDB tbody");
  tbody.innerHTML = "";
  document.getElementById("dbVacio").classList.toggle("d-none", reglas.length > 0);

  reglas.forEach((r) => {
    const tr = document.createElement("tr");
    if (r.id_regla === lastInsertedId) tr.classList.add("nueva");
    tr.innerHTML = `<td>${r.id_regla}</td><td>${r.id_usuario}</td><td>${escapeHtml(r.prompt)}</td><td>${r.categoria}</td><td>${r.activa}</td><td>${r.fecha_creacion}</td>`;
    tbody.appendChild(tr);
  });
}

/* -------- Tab "NIP Activo": define la bifurcación del Task Flow 1 -------- */
function wireSeguridad() {
  const cfg = ModerAIStorage.getUsuarioConfig();
  const toggle = document.getElementById("nipActivoToggle");
  const setBlock = document.getElementById("setNipBlock");
  toggle.checked = !!cfg.nip_activo;
  setBlock.classList.toggle("d-none", !(cfg.nip_activo && !cfg.pin_hash));

  toggle.addEventListener("change", () => {
    const c = ModerAIStorage.getUsuarioConfig();
    c.nip_activo = toggle.checked ? 1 : 0;
    ModerAIStorage.setUsuarioConfig(c);
    setBlock.classList.toggle("d-none", !(toggle.checked && !c.pin_hash));
  });

  document.getElementById("btnGuardarNip").addEventListener("click", async () => {
    const nip = document.getElementById("nuevoNip").value.trim();
    if (!/^\d{4}$/.test(nip)) return showToast("El NIP debe tener 4 dígitos.", true);
    const c = ModerAIStorage.getUsuarioConfig();
    c.pin_hash = await ModerAIStorage.hashPin(nip);
    c.nip_activo = 1;
    c.intentos_fallidos = 0;
    c.bloqueado_hasta = null;
    ModerAIStorage.setUsuarioConfig(c);
    document.getElementById("setNipBlock").classList.add("d-none");
    showToast("NIP configurado. Se solicitará al guardar reglas.");
  });
}

/* -------- Formulario "Crear nueva regla personalizada": paso central del Task Flow 1 -------- */
function wireForm() {
  const prompt = document.getElementById("promptTexto");
  const btnGuardar = document.getElementById("btnGuardar");

  prompt.addEventListener("input", () => {
    btnGuardar.disabled = prompt.value.trim().length === 0;
  });

  document.getElementById("formRegla").addEventListener("submit", (e) => {
    e.preventDefault();
    const formError = document.getElementById("formError");
    formError.classList.add("d-none");

    const cfg = ModerAIStorage.getUsuarioConfig();
    if (cfg.bloqueado_hasta && Date.now() < cfg.bloqueado_hasta) {
      const mins = Math.ceil((cfg.bloqueado_hasta - Date.now()) / 60000);
      formError.textContent = `Edición bloqueada por NIP fallido. Intenta en ${mins} min.`;
      formError.classList.remove("d-none");
      return;
    }

    // Fila lista para insertarse en regla_filtro (mismas columnas que db/schema.sql + sensibilidad de UI)
    const regla = {
      id_regla: Date.now(),
      id_usuario: ModerAIStorage.USER_ID,
      prompt: prompt.value.trim(),
      categoria: document.getElementById("categoria").value,
      sensibilidad: document.getElementById("sensibilidad").value,
      activa: 1,
      fecha_creacion: new Date().toISOString().slice(0, 10)
    };

    if (cfg.nip_activo && cfg.pin_hash) {
      pendingRegla = regla;
      openModalNip();
    } else {
      commitRegla(regla);
    }
  });
}

/* -------- Modal NIP (rama "SÍ") -------- */
function wireModalNip() {
  document.getElementById("btnConfirmarNip").addEventListener("click", async () => {
    const nipError = document.getElementById("nipError");
    const nip = document.getElementById("inputNip").value.trim();
    const cfg = ModerAIStorage.getUsuarioConfig();
    const hash = await ModerAIStorage.hashPin(nip);

    if (hash === cfg.pin_hash) {
      cfg.intentos_fallidos = 0;
      cfg.bloqueado_hasta = null;
      ModerAIStorage.setUsuarioConfig(cfg);
      bsModalNip.hide();
      commitRegla(pendingRegla);
      pendingRegla = null;
    } else {
      cfg.intentos_fallidos = (cfg.intentos_fallidos || 0) + 1;
      if (cfg.intentos_fallidos >= 3) {
        cfg.bloqueado_hasta = Date.now() + 5 * 60 * 1000;
        cfg.intentos_fallidos = 0;
        ModerAIStorage.setUsuarioConfig(cfg);
        bsModalNip.hide();
        showToast("NIP incorrecto 3 veces. Edición bloqueada 5 minutos.", true);
        pendingRegla = null;
        return;
      }
      ModerAIStorage.setUsuarioConfig(cfg);
      nipError.textContent = `NIP incorrecto (${cfg.intentos_fallidos}/3).`;
      nipError.classList.remove("d-none");
    }
  });
}
function openModalNip() {
  document.getElementById("inputNip").value = "";
  document.getElementById("nipError").classList.add("d-none");
  bsModalNip.show();
  setTimeout(() => document.getElementById("inputNip").focus(), 300);
}

/* -------- Guarda en la "BD", sincroniza con la API, notifica y refresca todo -------- */
async function commitRegla(regla) {
  if (guardandoRegla) return;
  guardandoRegla = true;
  document.getElementById("btnGuardar").disabled = true;
  try {
    regla = await ModerAIStorage.guardarRegla(regla);
  } catch (error) {
    showToast(`No se pudo confirmar el guardado. Recarga para comprobar antes de reintentar. ${error.message}`, true);
    document.getElementById("btnGuardar").disabled = false;
    return;
  } finally {
    guardandoRegla = false;
  }
  lastInsertedId = regla.id_regla;
  renderReglas();
  renderDB();
  renderJohnsonBox();
  document.getElementById("formRegla").reset();
  document.getElementById("sensibilidad").value = "Normal";
  document.getElementById("btnGuardar").disabled = true;

  showToast(location.protocol === "chrome-extension:" ? "Regla guardada en MySQL y activa en la extensión." : "Regla guardada localmente.");
}

function showToast(msg, isError = false) {
  const toastEl = document.getElementById("toast");
  document.getElementById("toastBody").textContent = msg;
  toastEl.classList.toggle("bg-danger", isError);
  toastEl.classList.toggle("bg-dark", !isError);
  bsToast.show();
}
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

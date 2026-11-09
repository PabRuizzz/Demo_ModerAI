# ModerAI — Prototipo navegable con el CFP integrado

Feed de prueba + popup de extensión + dashboard de reglas, conectados a un modelo real (el CFP) servido por FastAPI.

## Estructura
```
api/main.py            # CFP como servicio: POST /api/evaluar (certeza 0-100 por post×regla) + sirve el prototipo
db/schema.sql          # regla_filtro, usuario_config, historial_moderacion
src/shared/            # storage.js (BD simulada), api-client.js, moderador.js (decisión), posts-demo.js (posts de prueba)
src/feed/              # feed simulado + icono de la extensión (arriba a la derecha) que abre el popup
src/popup/             # Popup HUD: reglas activas, bloqueos hoy, sensibilidad
src/options/           # Dashboard: crear reglas por prompt (Task Flow 1)
```

## Cómo correrlo
```bash
pip install -r api/requirements.txt
uvicorn api.main:app --port 8000          # modelo: embeddings (default)
# MODERAI_MODELO=zeroshot uvicorn ...     # o el enfoque que gane en su notebook
# MODERAI_MODELO=keywords uvicorn ...     # sin modelo, solo para probar la integración
```
Abrir **http://localhost:8000/src/feed/feed.html** (por http, para que el feed, el popup y la configuración compartan la BD en localStorage).

## Qué pasa en cada carga
1. El feed lee las reglas activas de `regla_filtro` (localStorage).
2. Envía los 14 posts y las reglas a `/api/evaluar`; mientras responde, todos los posts salen difuminados ("Analizando…").
3. Con la certeza devuelta decide: **difuminar si certeza ≥ umbral**, donde umbral = sensibilidad del popup ± ajuste de la regla (Baja +15, Normal 0, Alta −15).
4. Al guardar o cambiar reglas en Configuración, el feed se reevalúa solo; al mover la sensibilidad en el popup se re-decide sin llamar de nuevo al modelo.

Reglas para probar: `Ocultar spoilers de La Casa de los Famosos` (Spoiler) · `Filtrar spam y estafas comerciales` (Spam) · `Ocultar insultos y acoso` (Odio).

## Calibración
`EMB_CENTRO` y `EMB_PENDIENTE` en `api/main.py` convierten la similitud del embedding en "certeza". Son valores iniciales sin validar: ajústenlos con los resultados del notebook.

## Publicar y aprender (sin cuenta)
- En el feed escribes **nombre del usuario + texto** y publicas; no hay registro. El post entra difuminado ("Analizando…") hasta que el modelo lo dictamina.
- **"Reportar error"** (post difuminado ya revelado) guarda la corrección con etiqueta 0; **"Marcar como …"** (post visible) con etiqueta 1.
- En cada evaluación la API recibe esas correcciones y ajusta la certeza de los posts parecidos (±hasta 60 pts según similitud); el mismo post queda fijado en 0 o 100. Constantes: `SIM_MIN`, `PASO`, `TOPE` en `api/main.py`.
- "Reiniciar demo" (Configuración) borra reglas, posts publicados, historial y correcciones.

## Extensión de navegador (X)
`manifest.json` en la raíz convierte este proyecto en una extensión de Chrome (Manifest V3):
`src/content/content.js` (detecta y difumina posts en x.com), `src/background.js` (llama a la API) y el popup/opciones de siempre.
1. Inicia la API (`uvicorn api.main:app --port 8000`).
2. `chrome://extensions` → activa "Modo de desarrollador" → "Cargar descomprimida" → elige la carpeta del proyecto.
3. Abre el icono de ModerAI → "Gestionar reglas" → crea una regla → abre x.com. Tras cambiar el código, pulsa "Recargar" en la tarjeta de la extensión y recarga la pestaña de X.
Cuando la API esté en Azure: cambia `API_BASE` en `src/background.js` y agrega la URL a `host_permissions` en `manifest.json`.

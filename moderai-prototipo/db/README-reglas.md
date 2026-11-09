# Reglas en MySQL: despliegue de la demo

1. Como administrador en Workbench, ejecutar `002_identidad_extension.sql`
   en la base `moderai`. No ejecutar de nuevo todo `schema.sql`.
2. Copiar `api/main.py`, `api/database.py` y `api/rules.py` a `~/moderai/api/`.
3. Mantener las variables DB_HOST, DB_USER, DB_PASSWORD, DB_NAME y DB_SSL_CA
   en la sesión de Ubuntu. Iniciar Uvicorn manualmente como antes.
4. Mantener el túnel SSH a localhost:8000 y recargar la extensión y X.
5. Abrir Gestionar reglas, crear una regla y confirmar el mensaje de guardado.
6. Verificar desde Workbench:

```sql
SELECT id_regla, id_usuario, prompt, categoria, sensibilidad, activa, fecha_creacion
FROM moderai.regla_filtro ORDER BY id_regla DESC LIMIT 20;
```

Cerrar y volver a abrir el panel debe recuperar las reglas. El botón
"Limpiar datos locales" no borra reglas del servidor ni la identidad.

## Alcance

- POST /api/instalacion registra una identidad aleatoria de 256 bits. MySQL
  guarda su SHA-256; la extensión conserva el token en chrome.storage.local.
- GET /api/reglas y POST /api/reglas requieren Authorization: Bearer TOKEN.
  El servidor determina el propietario, nunca acepta uno enviado por el cliente.
- Los identificadores de reglas son asignados por MySQL.
- No se crean tablas desde la cuenta limitada moderai_app.
- Un fallo de guardado no se muestra como éxito; ante respuesta perdida,
  recargar antes de reintentar para evitar duplicar una regla ya confirmada por MySQL.
- Las reglas locales anteriores se respaldan bajo reglas_locales_respaldo
  en localStorage/chrome.storage.local, pero no se importan automáticamente.
  Crear nuevamente las que se quieran usar en la prueba con MySQL.
- Desinstalar o borrar todos los datos de la extensión pierde su token;
  todavía no hay recuperación de cuenta ni sincronización entre dispositivos.
- Configuración, PIN, historial y correcciones siguen siendo locales.
  El feed HTML de demostración conserva su almacenamiento local.
- Mantener la API en loopback y usar el túnel SSH durante esta etapa.

## Pruebas locales sin Azure

Con FastAPI y httpx instalados, desde la raíz del proyecto:

```bash
python -m unittest discover -s tests -v
```

Las pruebas utilizan un conector simulado; la comprobación final de persistencia
se hace contra Azure siguiendo los pasos anteriores.

# ModerAI local

Copia independiente del proyecto, preparada para GitHub Desktop y para ejecutar
FastAPI, el modelo multilingue de embeddings y MySQL 8.4 en tu computadora.
La carpeta original no se modifica. No requiere Azure ni claves SSH.

## GitHub Desktop
File > Add local repository > selecciona esta carpeta (Demo-ModerAI-Local).
Incluye el historial y el remoto del repositorio original, con los cambios locales
en la rama codex/local-development. Revisa los cambios y haz commit cuando quieras.
No se ha publicado ni enviado nada a GitHub.

## Iniciar en Windows
1. Instala Docker Desktop y abre el motor con contenedores Linux.
2. Abre PowerShell en esta carpeta y ejecuta:
   powershell -ExecutionPolicy Bypass -File .\Iniciar-Local.ps1
3. Abre http://localhost:8000/src/feed/feed.html

La primera vez se descargan imagenes, dependencias y el modelo real
paraphrase-multilingual-MiniLM-L12-v2. La inferencia ocurre en CPU local:
los textos no se envian a una API de IA. No necesitas GPU.
El script genera contrasenas locales en .env, excluido de Git.
El puerto 8000 debe estar libre; cierra cualquier tunel SSH anterior que lo use.
La API escucha solamente en la interfaz local del equipo. MySQL no publica puertos.

## Extension
En chrome://extensions activa el modo desarrollador, carga descomprimida la carpeta
moderai-prototipo de ESTA copia y desactiva la otra copia para evitar confusiones.
La extension usa http://localhost:8000.
Las reglas creadas desde la extension se guardan en MySQL.
El feed de demostracion conserva su almacenamiento original en localStorage.
El historial, correcciones y ajustes del navegador conservan su comportamiento
original: no todos se sincronizan con las tablas SQL.

## Datos y modelo
MySQL inicia una base NUEVA con las tablas de db/schema.sql y
db/002_identidad_extension.sql. No se importan los datos de Azure.
Los volumenes mysql_data y model_cache conservan la base y el modelo entre reinicios.
No uses docker compose down -v si deseas conservarlos.
Tras la primera descarga, el modelo se reutiliza desde la cache local.
No cambies las contrasenas de .env sin actualizar tambien el usuario de MySQL
cuando la base ya exista.

## Comandos utiles
- Estado: docker compose ps
- Logs: docker compose logs --tail 100
- Detener: docker compose stop
- Volver a iniciar: docker compose start
- Aplicar cambios de Python: docker compose restart api
- Aplicar cambios de dependencias: vuelve a ejecutar Iniciar-Local.ps1
- Salud del modelo: http://localhost:8000/api/salud
- Salud de MySQL: http://localhost:8000/api/salud/db
- Documentacion API: http://localhost:8000/docs

El codigo de api/ y src/ se monta desde esta copia, por lo que puedes editarlo.
La conexion SQL sin TLS se habilita explicitamente solo en la red local de
contenedores de esta configuracion. El codigo mantiene TLS verificado por defecto
para otras configuraciones. El script antiguo iniciar-vm.sh se conserva como referencia;
no forma parte del arranque local.

## Pruebas sin descargar el modelo
Con Python 3.12 y fastapi, httpx, mysql-connector-python instalados:
cd moderai-prototipo
python -m unittest discover -s tests

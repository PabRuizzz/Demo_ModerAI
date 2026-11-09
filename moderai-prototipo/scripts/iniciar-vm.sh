#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/moderai"
if [[ ! -f .venv/bin/activate || ! -f api/main.py ]]; then
  echo "Falta el entorno virtual o el backend en ~/moderai."
  exit 1
fi
source .venv/bin/activate

export DB_HOST="moderai-db.mysql.database.azure.com"
export DB_PORT="3306"
export DB_NAME="moderai"
export DB_USER="moderai_app"
export DB_SSL_CA="/etc/ssl/certs/ca-certificates.crt"
export MODERAI_MODELO="embeddings"

read -r -s -p "Contrasena de moderai_app (no se guardara): " DB_PASSWORD
echo
export DB_PASSWORD

echo "Verificando la conexion con MySQL..."
python - <<'PY'
import sys
from api.database import check_database
try:
    check_database()
except Exception:
    print("No se pudo conectar con MySQL. Revisa que este encendido, la contrasena y el firewall.")
    sys.exit(1)
print("MySQL conectado con TLS y tablas accesibles.")
PY

echo "Iniciando modelo y API. Espera Application startup complete."
echo "Deja esta ventana abierta. Ctrl+C detiene la API y cierra el tunel."
exec python -m uvicorn api.main:app --host 127.0.0.1 --port 8000

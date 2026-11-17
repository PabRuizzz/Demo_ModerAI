"""Conexión MySQL por variables de entorno, con TLS verificado."""
import os
from contextlib import contextmanager
from pathlib import Path


TABLES = (
    "usuario_config", "regla_filtro",
    "historial_moderacion", "correccion_usuario", "identidad_extension",
)


def connection_options():
    ssl_mode = os.getenv("DB_SSL_MODE", "verify_identity")
    if ssl_mode not in ("verify_identity", "disabled"):
        raise ValueError("DB_SSL_MODE debe ser verify_identity o disabled")
    required = ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME")
    if ssl_mode == "verify_identity":
        required += ("DB_SSL_CA",)
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise ValueError("Faltan variables: " + ", ".join(missing))
    if ssl_mode == "verify_identity" and not Path(os.environ["DB_SSL_CA"]).is_file():
        raise ValueError("DB_SSL_CA debe apuntar a un archivo de certificados CA")
    options = {
        "host": os.environ["DB_HOST"],
        "port": int(os.environ.get("DB_PORT", "3306")),
        "user": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
        "database": os.environ["DB_NAME"],
        "connection_timeout": 10,
        "read_timeout": 10,
        "write_timeout": 10,
        "use_pure": True,
    }
    if ssl_mode == "disabled":
        options["ssl_disabled"] = True
    else:
        options.update(ssl_ca=os.environ["DB_SSL_CA"], ssl_verify_cert=True,
                       ssl_verify_identity=True, ssl_disabled=False)
    return options


@contextmanager
def connect_database():
    import mysql.connector
    connection = mysql.connector.connect(**connection_options())
    try:
        yield connection
    finally:
        connection.close()


def check_database():
    """Comprueba TLS y lectura de las cuatro tablas sin devolver datos de usuarios."""
    with connect_database() as connection:
        cursor = connection.cursor()
        try:
            cursor.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            cipher = cursor.fetchone()
            tls = bool(cipher and cipher[1])
            if os.getenv("DB_SSL_MODE", "verify_identity") != "disabled" and not tls:
                raise RuntimeError("La conexión no negoció TLS")
            for table in TABLES:
                # Los nombres provienen de una lista fija, nunca de una petición.
                cursor.execute(f"SELECT 1 FROM `{table}` LIMIT 1")
                cursor.fetchall()
            return {"listo": True, "tls": tls, "tablas_verificadas": list(TABLES)}
        finally:
            cursor.close()

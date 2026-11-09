"""Reglas privadas por instalación; las credenciales SQL nunca salen de la API."""
import hashlib
import uuid
from contextlib import contextmanager
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from api.database import connect_database

router = APIRouter(prefix="/api")


class NuevaRegla(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    categoria: Literal["SPOILER", "SPAM", "HATE_SPEECH", "CUSTOM_PROMPT"]
    sensibilidad: Literal["Baja", "Normal", "Alta"] = "Normal"


def token_digest(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Identidad de instalación requerida")
    token = authorization[7:]
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise HTTPException(401, "Identidad de instalación inválida")
    return hashlib.sha256(token.encode()).hexdigest()


@contextmanager
def transaction():
    try:
        with connect_database() as connection:
            cursor = connection.cursor(dictionary=True)
            try:
                yield connection, cursor
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                cursor.close()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "No se pudo acceder a MySQL. Revisa la configuración y la migración SQL.") from None


def get_user(cursor, digest):
    cursor.execute("SELECT id_usuario FROM identidad_extension WHERE token_hash = %s", (digest,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(401, "Instalación no registrada")
    return row["id_usuario"]


@router.post("/instalacion")
def register(authorization: str | None = Header(default=None)):
    digest = token_digest(authorization)
    with transaction() as (_, cursor):
        cursor.execute("SELECT id_usuario FROM identidad_extension WHERE token_hash = %s", (digest,))
        row = cursor.fetchone()
        if row:
            return row
        user_id = str(uuid.uuid4())
        cursor.execute("INSERT INTO usuario_config (id_usuario) VALUES (%s)", (user_id,))
        cursor.execute("INSERT INTO identidad_extension (token_hash, id_usuario) VALUES (%s, %s)", (digest, user_id))
        return {"id_usuario": user_id}


@router.get("/reglas")
def list_rules(authorization: str | None = Header(default=None)):
    digest = token_digest(authorization)
    with transaction() as (_, cursor):
        user_id = get_user(cursor, digest)
        cursor.execute("SELECT id_regla, id_usuario, prompt, categoria, sensibilidad, activa, fecha_creacion FROM regla_filtro WHERE id_usuario = %s ORDER BY id_regla", (user_id,))
        return {"id_usuario": user_id, "reglas": cursor.fetchall()}


@router.post("/reglas", status_code=201)
def create_rule(rule: NuevaRegla, authorization: str | None = Header(default=None)):
    digest = token_digest(authorization)
    prompt = rule.prompt.strip()
    if not prompt:
        raise HTTPException(422, "La regla no puede estar vacía")
    with transaction() as (_, cursor):
        user_id = get_user(cursor, digest)
        cursor.execute("INSERT INTO regla_filtro (id_usuario, prompt, categoria, sensibilidad, activa, fecha_creacion) VALUES (%s, %s, %s, %s, 1, CURRENT_DATE)", (user_id, prompt, rule.categoria, rule.sensibilidad))
        cursor.execute("SELECT id_regla, id_usuario, prompt, categoria, sensibilidad, activa, fecha_creacion FROM regla_filtro WHERE id_regla = %s AND id_usuario = %s", (cursor.lastrowid, user_id))
        return cursor.fetchone()

"""API de ModerAI: expone el CFP (modelo que puntúa post vs. regla) y sirve el prototipo.
Ejecutar desde la raíz del proyecto:  uvicorn api.main:app --port 8000
Abrir:  http://localhost:8000/src/feed/feed.html
Modelo (variable MODERAI_MODELO): embeddings (default) | zeroshot | keywords (sin modelo, solo para probar)."""
import hashlib, math, mimetypes, os, re, threading, time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from api.database import check_database
from api.rules import router as rules_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

MODELO = os.getenv("MODERAI_MODELO", "embeddings")
MODELO_EMB = os.getenv("MODERAI_EMB", "paraphrase-multilingual-MiniLM-L12-v2")
MODELO_ZS = os.getenv("MODERAI_ZS", "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7")
EMB_CENTRO, EMB_PENDIENTE = 0.35, 12.0  # similitud coseno -> certeza 0-100. CALIBRAR con el notebook del CFP.
ROOT = Path(__file__).resolve().parent.parent

# En Windows el registro a veces asigna text/plain a .html/.js/.css y el navegador muestra el código en vez de la página.
for _ext, _tipo in {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}.items():
    mimetypes.add_type(_tipo, _ext)

# Misma lógica de prompts que el notebook del CFP, ahora una plantilla por categoría de la regla.
PLANT_ZS = {
    "SPOILER": "Este texto revela un resultado o un secreto sobre {}.",
    "SPAM": "Este texto es spam, publicidad engañosa o una estafa de tipo {}.",
    "HATE_SPEECH": "Este texto contiene insultos, acoso u odio sobre {}.",
    "CUSTOM_PROMPT": "Este texto trata sobre {}.",
}
PLANT_EMB = {
    "SPOILER": "Revela quién ganó, quién fue eliminado o el resultado de {tema}",
    "SPAM": "Spam, publicidad engañosa o estafa: {tema}",
    "HATE_SPEECH": "Insultos, acoso u odio: {tema}",
    "CUSTOM_PROMPT": "{tema}",
}

class Post(BaseModel):
    id: int
    texto: str

class Regla(BaseModel):
    id_regla: int
    prompt: str
    categoria: str = "CUSTOM_PROMPT"

class Correccion(BaseModel):
    id_regla: int
    texto: str
    etiqueta: int  # 0 = el usuario dijo que NO pertenece a la regla (reporte), 1 = sí pertenece

class Peticion(BaseModel):
    posts: list[Post]
    reglas: list[Regla]
    correcciones: list[Correccion] = []

# Aprendizaje (vecinos más cercanos): cada corrección empuja la certeza de los posts parecidos.
SIM_MIN, PASO, TOPE, SIM_EXACTA = 0.45, 50.0, 60.0, 0.97

M, CACHE, LOCK = {}, {}, threading.Lock()

@asynccontextmanager
async def lifespan(app):
    if MODELO == "embeddings":
        from sentence_transformers import SentenceTransformer
        M["m"] = M["emb"] = SentenceTransformer(MODELO_EMB)
    elif MODELO == "zeroshot":
        from transformers import pipeline
        M["m"] = pipeline("zero-shot-classification", model=MODELO_ZS)
        from sentence_transformers import SentenceTransformer
        M["emb"] = SentenceTransformer(MODELO_EMB)  # para comparar posts con las correcciones
    yield

app = FastAPI(lifespan=lifespan)
app.include_router(rules_router)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def tema_de_regla(prompt: str) -> str:
    t = re.sub(r"^\s*(ocultar|filtrar|bloquear)\s+(noticias|spoilers?|publicaciones|contenido)?\s*(de|sobre)?\s*", "", prompt, flags=re.I).strip()
    return t or prompt.strip()

def puntuar(textos, tema, cat):
    if MODELO == "zeroshot":
        out = M["m"](textos, candidate_labels=[tema], hypothesis_template=PLANT_ZS[cat], multi_label=True)
        out = out if isinstance(out, list) else [out]
        return [100 * o["scores"][0] for o in out]
    if MODELO == "embeddings":
        from sentence_transformers import util
        e = M["m"].encode(textos + [PLANT_EMB[cat].format(tema=tema)], convert_to_tensor=True)
        sims = util.cos_sim(e[:-1], e[-1:]).flatten().tolist()
        return [100 / (1 + math.exp(-(s - EMB_CENTRO) * EMB_PENDIENTE)) for s in sims]
    claves = [w for w in re.findall(r"\w+", tema.lower()) if len(w) > 3]
    return [100 * sum(k in t.lower() for k in claves) / max(1, len(claves)) for t in textos]

def similitudes(textos, refs):
    if "emb" in M:
        from sentence_transformers import util
        e = M["emb"].encode(textos + refs, convert_to_tensor=True)
        return util.cos_sim(e[:len(textos)], e[len(textos):]).tolist()
    toks = lambda t: set(re.findall(r"\w+", t.lower()))   # sin modelo: traslape de palabras
    return [[len(toks(a) & toks(b)) / max(1, len(toks(a) | toks(b))) for b in refs] for a in textos]

def aprender(base, textos, corr):
    """Devuelve [(certeza_final, ajuste)] aplicando las correcciones del usuario sobre la certeza del modelo."""
    if not corr:
        return [(b, 0.0) for b in base]
    out = []
    for b, fila in zip(base, similitudes(textos, [c.texto for c in corr])):
        aj, fijo = 0.0, None
        for s, c in zip(fila, corr):
            if s >= SIM_EXACTA:
                fijo = 100.0 if c.etiqueta else 0.0      # el mismo post: manda la decisión explícita del usuario
            elif s > SIM_MIN:
                aj += (1 if c.etiqueta else -1) * PASO * (s - SIM_MIN) / (1 - SIM_MIN)
        final = fijo if fijo is not None else max(0.0, min(100.0, b + max(-TOPE, min(TOPE, aj))))
        out.append((round(final, 1), round(final - b, 1)))
    return out

@app.get("/api/salud")
def salud():
    return {"modelo": MODELO, "listo": MODELO == "keywords" or "m" in M}

@app.get("/api/salud/db")
def salud_db():
    try:
        return check_database()
    except Exception:
        # No devolver errores del conector: pueden contener datos de conexión.
        raise HTTPException(
            status_code=503,
            detail="MySQL no disponible. Revisa variables, firewall, TLS y permisos.",
        ) from None


@app.post("/api/evaluar")
def evaluar(req: Peticion):
    t0, resultados, en_cache = time.perf_counter(), [], 0
    with LOCK:
        for r in req.reglas:
            tema = tema_de_regla(r.prompt)
            cat = r.categoria if r.categoria in PLANT_EMB else "CUSTOM_PROMPT"
            llave = {p.id: f"{MODELO}|{cat}|{tema}|{hashlib.sha1(p.texto.encode()).hexdigest()}" for p in req.posts}
            pend = [p for p in req.posts if llave[p.id] not in CACHE]
            if pend:
                for p, c in zip(pend, puntuar([p.texto for p in pend], tema, cat)):
                    CACHE[llave[p.id]] = round(c, 1)
            en_cache += len(req.posts) - len(pend)
            base = [CACHE[llave[p.id]] for p in req.posts]
            fin = aprender(base, [p.texto for p in req.posts], [c for c in req.correcciones if c.id_regla == r.id_regla])
            resultados += [{"id_post": p.id, "id_regla": r.id_regla, "base": b, "ajuste": a, "certeza": c}
                           for p, b, (c, a) in zip(req.posts, base, fin)]
    return {"modelo": MODELO, "ms": round((time.perf_counter() - t0) * 1000), "en_cache": en_cache, "resultados": resultados}

# Solo los archivos del frontend son públicos. Nunca servir la raíz del
# proyecto: puede contener código, entornos virtuales y credenciales.
# En la VM se puede desplegar únicamente api/, sin el feed de demostración.
FRONTEND_DIR = ROOT / "src"
if FRONTEND_DIR.is_dir():
    app.mount("/src", StaticFiles(directory=FRONTEND_DIR, html=True), name="web")

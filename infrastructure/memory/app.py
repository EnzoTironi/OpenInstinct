"""Private Mem0 adapter. Zoen resolves membership; this service never accepts users directly."""

import hashlib
import os
import secrets
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from mem0 import Memory
from mem0.memory.storage import SQLiteManager
from pydantic import BaseModel, ConfigDict, Field
from psycopg.types.json import Jsonb
from ledger import MemoryLedger
from migrate_legacy import migrate_legacy

REVISION = "c7ee362aff94a369af70f13f2b4f853f6793ff4c"
lock = threading.RLock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    key = os.environ["ZOEN_MEM0_API_KEY"]
    if len(key) < 32:
        raise RuntimeError("A strong service key is required")
    data = Path(os.environ.get("ZOEN_MEMORY_DATA", "/data"))
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    config = {
        "version": "v1.1",
        "vector_store": {"provider": "pgvector", "config": {
            "connection_string": os.environ["ZOEN_MEMORY_DATABASE_URL"],
            "collection_name": "zoen_memories", "embedding_model_dims": 1536,
            "minconn": 1, "maxconn": 4, "hnsw": True,
        }},
        "llm": {"provider": "openai", "config": {
            "api_key": os.environ["OPENROUTER_API_KEY"],
            "openai_base_url": "https://openrouter.ai/api/v1",
            "model": os.environ.get("ZOEN_MEMORY_MODEL", "openai/gpt-5-mini"),
            "temperature": 0.1,
        }},
        "embedder": {"provider": "openai", "config": {
            "api_key": os.environ["OPENROUTER_API_KEY"],
            "openai_base_url": "https://openrouter.ai/api/v1",
            "model": "openai/text-embedding-3-small", "embedding_dims": 1536,
        }},
        # Mem0's auxiliary extraction messages must not resurrect forgotten facts.
        # Only learned vectors and content-free operation receipts are durable.
        "history_db_path": ":memory:",
    }
    app.state.memory = Memory.from_config(config)
    app.state.memory.vector_store.create_col()
    app.state.memory.llm.client = app.state.memory.llm.client.with_options(timeout=20.0, max_retries=0)
    app.state.memory.embedding_model.client = app.state.memory.embedding_model.client.with_options(timeout=10.0, max_retries=0)
    app.state.key = key
    app.state.ledger = MemoryLedger(os.environ["ZOEN_MEMORY_DATABASE_URL"])
    try:
        migrate_legacy(data, app.state.ledger)
        yield
    finally:
        app.state.memory.close()
        app.state.ledger.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def authenticate(request: Request, call_next):
    if request.url.path != "/health":
        expected = "Bearer " + app.state.key
        if not secrets.compare_digest(request.headers.get("authorization", ""), expected):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        length = request.headers.get("content-length", "")
        if not length.isdigit() or int(length) > 32768:
            return JSONResponse({"error": "request_too_large"}, status_code=413)
    response = await call_next(request)
    response.headers["cache-control"] = "no-store"
    return response


class MemoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    namespace: UUID
    action: Literal["list", "search", "remember", "update", "delete", "clear"]
    operation_id: str | None = Field(default=None, min_length=1, max_length=256)
    text: str | None = Field(default=None, min_length=1, max_length=8000)
    memory_id: UUID | None = None
    infer: bool = True


def rows(result):
    return result.get("results", [])


def serialize(item):
    return {"id": item["id"], "memory": item["memory"], "createdAt": item.get("created_at"), "updatedAt": item.get("updated_at")}


def owned(memory, namespace, memory_id):
    item = memory.get(str(memory_id)) if memory_id else None
    if not item or item.get("user_id") != namespace:
        raise HTTPException(404, "memory_not_found")
    return item


def apply_operation(memory, request, namespace):
    if request.action == "remember":
        if not request.text:
            raise HTTPException(422, "text_required")
        result = memory.add(request.text, user_id=namespace, infer=request.infer,
                            metadata={"zoen_operation": request.operation_id})
        return {"ids": [item["id"] for item in rows(result)]}
    if request.action == "clear":
        memory.delete_all(user_id=namespace)
        return {"ids": []}
    owned(memory, namespace, request.memory_id)
    if request.action == "delete":
        memory.delete(str(request.memory_id))
    elif request.action == "update":
        if not request.text:
            raise HTTPException(422, "text_required")
        memory.update(str(request.memory_id), text=request.text)
    return {"ids": [str(request.memory_id)]}


@app.get("/health")
def health():
    try:
        if not app.state.ledger.healthy():
            raise RuntimeError("Memory collection unavailable")
        return {"ok": True, "backend": "mem0-pgvector", "revision": REVISION}
    except Exception:
        raise HTTPException(503, "memory_unavailable") from None


@app.post("/v1/memory")
def memory_operation(request: MemoryRequest):
    namespace = str(request.namespace)
    memory = app.state.memory
    # The local lock protects Mem0's auxiliary in-memory history. PostgreSQL
    # serializes a namespace across replicas and survives process restarts.
    with lock:
        try:
            with app.state.ledger.namespace(namespace) as db:
                if request.action == "list":
                    return {"results": [serialize(item) for item in rows(memory.get_all(filters={"user_id": namespace}, top_k=200))]}
                if request.action == "search":
                    if not request.text:
                        raise HTTPException(422, "text_required")
                    return {"results": [serialize(item) for item in rows(memory.search(request.text, filters={"user_id": namespace}, top_k=8))]}
                if not request.operation_id:
                    raise HTTPException(422, "operation_id_required")
                digest = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
                row = db.execute("SELECT request_hash, result FROM memory_operations WHERE namespace=%s AND operation_id=%s",
                                 (namespace, request.operation_id)).fetchone()
                if row:
                    if row[0] != digest:
                        raise HTTPException(409, "operation_conflict")
                    if row[1] is None:
                        # A crash may have happened after a write. Never blindly ingest twice.
                        raise HTTPException(409, "operation_needs_reconciliation")
                    return row[1]
                if request.action == "remember" and len(rows(memory.get_all(filters={"user_id": namespace}, top_k=200))) >= 200:
                    raise HTTPException(409, "memory_limit")
                db.execute("INSERT INTO memory_operations VALUES (%s, %s, %s, NULL)", (namespace, request.operation_id, digest))
                result = apply_operation(memory, request, namespace)
                db.execute("UPDATE memory_operations SET result=%s WHERE namespace=%s AND operation_id=%s",
                           (Jsonb(result), namespace, request.operation_id))
                return result
        except HTTPException:
            raise
        except Exception:
            # Provider errors can contain inputs or credentials. Keep them off the wire.
            raise HTTPException(503, "memory_unavailable") from None
        finally:
            memory.db.close()
            memory.db = SQLiteManager(":memory:")

"""Atomic legacy import; retained source files are never a second live writer."""

import json
import sqlite3

from psycopg.types.json import Jsonb
from qdrant_client import QdrantClient


def import_vectors(path, db):
    if not path.is_dir():
        return 0
    source = QdrantClient(path=str(path))
    try:
        if not source.collection_exists("zoen_memories"):
            return 0
        if db.execute("SELECT count(*) FROM zoen_memories").fetchone()[0]:
            raise RuntimeError("Refusing to merge two independent memory stores")
        imported, offset = 0, None
        while True:
            points, offset = source.scroll("zoen_memories", limit=100, offset=offset,
                                           with_vectors=True, with_payload=True)
            for point in points:
                if not isinstance(point.vector, list) or len(point.vector) != 1536:
                    raise RuntimeError("Legacy embedding dimensions do not match")
                db.execute("INSERT INTO zoen_memories (id, vector, payload) VALUES (%s, %s::vector, %s)",
                           (point.id, json.dumps(point.vector), Jsonb(point.payload)))
            imported += len(points)
            if offset is None:
                return imported
    finally:
        source.close()


def import_receipts(path, db):
    if not path.exists():
        return
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as old:
        for namespace, operation, digest, result in old.execute("SELECT namespace, operation_id, request_hash, result FROM operations"):
            db.execute("INSERT INTO memory_operations VALUES (%s, %s, %s, %s)",
                       (namespace, operation, digest, Jsonb(json.loads(result)) if result is not None else None))


def migrate_legacy(data, ledger):
    with ledger.pool.connection() as db, db.transaction():
        db.execute("SELECT pg_advisory_xact_lock(4217001)")
        if db.execute("SELECT 1 FROM memory_migrations WHERE name='qdrant-to-pgvector-v1'").fetchone():
            return
        imported = import_vectors(data / "vectors", db)
        import_receipts(data / "operations.db", db)
        db.execute("INSERT INTO memory_migrations(name, vector_count) VALUES ('qdrant-to-pgvector-v1', %s)", (imported,))

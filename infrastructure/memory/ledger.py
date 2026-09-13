"""Content-free receipts and per-namespace serialization shared by every API process."""

from contextlib import contextmanager

from psycopg_pool import ConnectionPool


class MemoryLedger:
    def __init__(self, url):
        self.pool = ConnectionPool(url, min_size=1, max_size=4, timeout=10,
                                   kwargs={"autocommit": True, "connect_timeout": 5}, open=False)
        self.pool.open(wait=True, timeout=15)
        with self.pool.connection() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS memory_operations (
                namespace UUID NOT NULL, operation_id TEXT NOT NULL,
                request_hash TEXT NOT NULL, result JSONB,
                PRIMARY KEY(namespace, operation_id))""")
            db.execute("""CREATE TABLE IF NOT EXISTS memory_migrations (
                name TEXT PRIMARY KEY, vector_count BIGINT NOT NULL,
                completed_at TIMESTAMPTZ NOT NULL DEFAULT now())""")

    @contextmanager
    def namespace(self, namespace):
        with self.pool.connection() as db:
            db.execute("SET lock_timeout = '10s'")
            db.execute("SELECT pg_advisory_lock(hashtextextended(%s, 4217))", (namespace,))
            try:
                yield db
            finally:
                db.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 4217))", (namespace,))

    def healthy(self):
        with self.pool.connection() as db:
            return db.execute("SELECT to_regclass('zoen_memories') IS NOT NULL").fetchone()[0]

    def close(self):
        self.pool.close()

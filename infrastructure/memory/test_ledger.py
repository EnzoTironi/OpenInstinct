import json
import os
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from qdrant_client import QdrantClient, models
import pytest

from ledger import MemoryLedger
from migrate_legacy import migrate_legacy


@pytest.fixture
def ledger_url():
    url = os.environ["ZOEN_MEMORY_DATABASE_URL"]
    schema = "proof_" + uuid4().hex
    with psycopg.connect(url, autocommit=True) as db:
        db.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    options = conninfo_to_dict(url)
    options["options"] = f"-c search_path={schema},public"
    scoped_url = make_conninfo(**options)
    try:
        with psycopg.connect(scoped_url, autocommit=True) as db:
            db.execute("CREATE TABLE zoen_memories (id UUID PRIMARY KEY, vector vector(1536), payload JSONB)")
        yield scoped_url
    finally:
        with psycopg.connect(url, autocommit=True) as db:
            db.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def test_namespace_locks_work_across_pools_and_release_on_failure(ledger_url):
    first, second = MemoryLedger(ledger_url), MemoryLedger(ledger_url)
    namespace = str(uuid4())
    attempted, entered = threading.Event(), threading.Event()

    def other_writer():
        attempted.set()
        with second.namespace(namespace):
            entered.set()

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with pytest.raises(RuntimeError):
                with first.namespace(namespace):
                    pending = pool.submit(other_writer)
                    assert attempted.wait(2)
                    assert not entered.wait(0.1)
                    raise RuntimeError("Simulated failed writer")
            pending.result(timeout=3)
            assert entered.is_set()
    finally:
        first.close()
        second.close()


def legacy_store(path, namespace, operation, dimension=1536):
    source = QdrantClient(path=str(path / "vectors"))
    source.create_collection("zoen_memories", vectors_config=models.VectorParams(size=dimension, distance=models.Distance.COSINE))
    memory_id = str(uuid4())
    source.upsert("zoen_memories", points=[models.PointStruct(id=memory_id, vector=[0.1] * dimension,
        payload={"user_id": namespace, "data": "Synthetic legacy preference"})])
    source.close()
    with sqlite3.connect(path / "operations.db") as db:
        db.execute("CREATE TABLE operations (namespace TEXT, operation_id TEXT, request_hash TEXT, result TEXT)")
        db.execute("INSERT INTO operations VALUES (?, ?, ?, ?)",
                   (namespace, operation, "synthetic-hash", json.dumps({"ids": [memory_id]})))
    return memory_id


def test_import_is_durable_and_does_not_resurrect_erased_memories(ledger_url, tmp_path):
    namespace, operation = str(uuid4()), str(uuid4())
    memory_id = legacy_store(tmp_path, namespace, operation)
    ledger = MemoryLedger(ledger_url)
    migrate_legacy(tmp_path, ledger)
    with ledger.pool.connection() as db:
        assert str(db.execute("SELECT id FROM zoen_memories").fetchone()[0]) == memory_id
        assert db.execute("SELECT result FROM memory_operations").fetchone()[0] == {"ids": [memory_id]}
        db.execute("DELETE FROM zoen_memories")
    ledger.close()
    restarted = MemoryLedger(ledger_url)
    try:
        migrate_legacy(tmp_path, restarted)
        with restarted.pool.connection() as db:
            assert db.execute("SELECT count(*) FROM zoen_memories").fetchone()[0] == 0
            assert db.execute("SELECT count(*) FROM memory_operations").fetchone()[0] == 1
        assert (tmp_path / "operations.db").exists()
    finally:
        restarted.close()


def test_invalid_legacy_store_rolls_back_without_a_completion_marker(ledger_url, tmp_path):
    legacy_store(tmp_path, str(uuid4()), str(uuid4()), dimension=3)
    ledger = MemoryLedger(ledger_url)
    try:
        with pytest.raises(RuntimeError, match="dimensions"):
            migrate_legacy(tmp_path, ledger)
        with ledger.pool.connection() as db:
            assert db.execute("SELECT count(*) FROM memory_migrations").fetchone()[0] == 0
            assert db.execute("SELECT count(*) FROM memory_operations").fetchone()[0] == 0
            assert db.execute("SELECT count(*) FROM zoen_memories").fetchone()[0] == 0
    finally:
        ledger.close()


def test_receipt_failure_rolls_back_vectors_already_imported(ledger_url, tmp_path):
    legacy_store(tmp_path, "invalid-namespace", str(uuid4()))
    ledger = MemoryLedger(ledger_url)
    try:
        with pytest.raises(psycopg.errors.InvalidTextRepresentation):
            migrate_legacy(tmp_path, ledger)
        with ledger.pool.connection() as db:
            assert db.execute("SELECT count(*) FROM zoen_memories").fetchone()[0] == 0
            assert db.execute("SELECT count(*) FROM memory_migrations").fetchone()[0] == 0
    finally:
        ledger.close()

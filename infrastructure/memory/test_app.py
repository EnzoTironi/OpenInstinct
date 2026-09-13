import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

os.environ["MEM0_TELEMETRY"] = "false"

import pytest
from fastapi.testclient import TestClient
from mem0 import Memory
import app as service


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ZOEN_MEM0_API_KEY", "test-service-key-" * 3)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-unused-provider-key")
    monkeypatch.setenv("ZOEN_MEMORY_DATA", str(tmp_path))
    original = Memory.from_config

    def local_memory(config):
        memory = original(config)

        def embed(text, *args, **kwargs):
            digest = hashlib.sha256(text.encode()).digest()
            return [(digest[i % len(digest)] + 1) / 256 for i in range(1536)]

        memory.embedding_model.embed = embed
        memory.llm.generate_response = lambda *args, **kwargs: pytest.fail("Unexpected model call in exact-memory test")
        return memory

    monkeypatch.setattr(service.Memory, "from_config", local_memory)
    with TestClient(service.app) as api:
        api.headers["authorization"] = "Bearer " + os.environ["ZOEN_MEM0_API_KEY"]
        yield api


def call(client, namespace, action, **fields):
    return client.post("/v1/memory", json={"namespace": namespace, "action": action, **fields})


def remember(client, namespace, text, operation=None):
    return call(client, namespace, "remember", text=text, infer=False, operation_id=operation or str(uuid4()))


def test_authentication_and_input_limits(client):
    assert client.get("/health", headers={"authorization": ""}).status_code == 200
    assert client.post("/v1/memory", json={}, headers={"authorization": ""}).status_code == 401
    assert client.post("/v1/memory", content="x" * 32769).status_code == 413
    assert call(client, "not-a-namespace", "list").status_code == 422


def test_real_mem0_isolation_and_forget(client):
    personal, work = str(uuid4()), str(uuid4())
    saved = remember(client, personal, "Synthetic preference: green tea.")
    assert saved.status_code == 200, saved.text
    memory_id = saved.json()["ids"][0]
    assert call(client, work, "list").json() == {"results": []}
    assert call(client, work, "search", text="green tea").json() == {"results": []}
    assert call(client, work, "delete", memory_id=memory_id, operation_id=str(uuid4())).status_code == 404
    assert call(client, work, "update", memory_id=memory_id, text="tampered", operation_id=str(uuid4())).status_code == 404
    items = call(client, personal, "list").json()["results"]
    assert [row["memory"] for row in items] == ["Synthetic preference: green tea."]
    assert call(client, personal, "update", memory_id=memory_id, text="Synthetic preference: black tea.", operation_id=str(uuid4())).status_code == 200
    assert call(client, personal, "search", text="black tea").json()["results"][0]["memory"] == "Synthetic preference: black tea."
    assert call(client, personal, "delete", memory_id=memory_id, operation_id=str(uuid4())).status_code == 200
    assert call(client, personal, "list").json() == {"results": []}
    assert service.app.state.memory.db.get_history(memory_id) == []


def test_replays_and_concurrent_requests_write_once(client):
    namespace, operation = str(uuid4()), str(uuid4())
    with ThreadPoolExecutor(max_workers=4) as pool:
        replies = list(pool.map(lambda _: remember(client, namespace, "Synthetic shared retry.", operation), range(4)))
    assert all(reply.status_code == 200 for reply in replies), [reply.text for reply in replies]
    assert len({reply.json()["ids"][0] for reply in replies}) == 1
    assert len(call(client, namespace, "list").json()["results"]) == 1
    assert remember(client, namespace, "Different content.", operation).status_code == 409
    assert call(client, namespace, "clear", operation_id=str(uuid4())).status_code == 200
    # A replay returns its receipt; it must never resurrect cleared content.
    assert remember(client, namespace, "Synthetic shared retry.", operation).status_code == 200
    assert call(client, namespace, "list").json()["results"] == []
    with service.app.state.ledger.pool.connection() as db:
        assert "Synthetic" not in str(db.execute("SELECT * FROM memory_operations").fetchall())


def test_provider_errors_are_redacted_and_ambiguous_writes_not_retried(client, monkeypatch):
    namespace, operation = str(uuid4()), str(uuid4())
    calls = []

    def fail(*args, **kwargs):
        calls.append(1)
        raise RuntimeError("secret-private-input-provider-key")

    monkeypatch.setattr(service.app.state.memory, "add", fail)
    first = remember(client, namespace, "test", operation)
    assert first.status_code == 503
    assert "secret" not in first.text
    assert remember(client, namespace, "test", operation).status_code == 409
    assert len(calls) == 1

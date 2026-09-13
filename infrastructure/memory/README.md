# Private Zoen memory service

This is the self-hosted Mem0 adapter consumed by Zoen. The SDK is pinned to
`c7ee362aff94a369af70f13f2b4f853f6793ff4c` in `uv.lock`; its Apache 2.0 license is
included. The service has no public Fly service or public IP.

## Runtime

- One worker, one embedded Qdrant writer, an encrypted `/data` volume.
- SQLite stores idempotency receipts containing namespace, operation hash and
  result IDs. Extraction history is in memory and cleared after operations.
- Bearer authentication is required for operations. `/health` reports readiness
  and the SDK revision without exposing configuration.
- `ZOEN_MEM0_API_KEY` authenticates Zoen. `OPENROUTER_API_KEY` authenticates model
  calls. Neither belongs in Git, user documents, logs or a browser response.
- Zoen sets `ZOEN_MEM0_URL=http://zoen-memory-tironi.internal:8000` and the same
  service key. LLM extraction uses `openai/gpt-5-mini`; embeddings use
  `openai/text-embedding-3-small` with 1536 dimensions. Self-hosting storage does
  not make those model requests local: submitted memory text goes to the model
  provider.

The adapter limits requests to 32 KiB and 200 memories per namespace. Model
clients have explicit timeouts and no automatic retries. One native lock protects
embedded Qdrant. Scaling this deployment to several writers requires an external
Qdrant service and a shared idempotency store first.

## Validation and deployment

```sh
uv sync --frozen
uv run pytest
fly deploy --config fly.toml --remote-only
fly checks list --app zoen-memory-tironi
```

Tests use the real pinned Mem0/Qdrant implementation with a deterministic local
embedding fixture. The delivery record separately records live-provider tests.
Never run the test suite against a production data directory.

## Failure and recovery

Zoen authorizes the live user and workspace in PostgreSQL before every access.
Each person's memory has a different opaque namespace, including inside a team.
Shared team knowledge lives in the Git workspace instead.

Before a mutation crosses the network, Zoen commits a pending-operation fence.
If the result is uncertain, recalled memory remains unavailable. The app offers
review of the service's current records followed by an explicit recovery action;
that action never repeats an old write. Clearing all memory is a separate action.
Cached recall receipts are tombstoned so an old replay cannot reintroduce forgotten
facts. Deleting an account or removing a workspace member queues durable erasure;
Eve drains the outbox every five minutes and retains failed receipts for retry.

Fly takes encrypted volume snapshots with 14-day retention. A deleted memory may
remain in a retained backup until that backup expires. Before restoring a snapshot,
stop the writer, restore to a replacement volume, and verify health and an isolated
namespace before attaching Zoen. Reconcile restored namespaces with current
PostgreSQL memberships and erasure receipts before enabling recall; a historical
snapshot must never restore access that has since been revoked.

This deployment is a single instance. It has restart persistence and snapshots,
not high availability. The volume and its SQLite/Qdrant contents form one recovery
unit; copying only vectors loses the idempotency record.

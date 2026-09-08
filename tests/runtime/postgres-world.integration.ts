import { randomUUID } from "node:crypto";
import { createWorld } from "@workflow/world-postgres";
import { Config, Effect, Redacted } from "effect";
import { Pool } from "pg";
import { expect, test } from "vitest";

test("Postgres retains workflow stream bytes and closure across client restart", async () => {
  const connectionString = Redacted.value(
    Effect.runSync(
      Config.redacted("WORKFLOW_POSTGRES_URL").pipe(
        Config.orElse(() => Config.redacted("DATABASE_URL"))
      )
    )
  );
  const runId = `companion-storage-proof-${randomUUID()}`;
  const name = `${runId}:stream`;
  const first = createWorld({ connectionString, maxPoolSize: 2 });
  try {
    await first.streams.write(runId, name, "stored before restart");
    await first.streams.write(runId, name, new Uint8Array([0, 127, 255]));
    await first.streams.close(runId, name);
  } finally {
    await first.close?.();
  }

  const second = createWorld({ connectionString, maxPoolSize: 2 });
  try {
    const stream = await second.streams.get(runId, name);
    const reader = stream.getReader();
    const chunks: number[] = [];
    try {
      for (;;) {
        // The real stream must terminate on its persisted close marker.
        // eslint-disable-next-line no-await-in-loop
        const next = await reader.read();
        if (next.done) break;
        chunks.push(...next.value);
      }
    } finally {
      reader.releaseLock();
    }
    expect(chunks).toEqual([
      ...new TextEncoder().encode("stored before restart"),
      0,
      127,
      255,
    ]);
    expect(await second.streams.list(runId)).toContain(name);
  } finally {
    await second.close?.();
    const cleanup = new Pool({ connectionString, max: 1 });
    try {
      await cleanup.query(
        "DELETE FROM workflow.workflow_stream_chunks WHERE run_id = $1",
        [runId]
      );
    } finally {
      await cleanup.end();
    }
  }
});

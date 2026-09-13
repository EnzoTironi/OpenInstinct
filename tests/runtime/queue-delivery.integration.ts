import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createWorld } from "@workflow/world-postgres";
import { Config, Effect, Redacted, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { runtimeDatabase } from "./database";

test("the restricted role delivers a real queued job through the native leased worker", async () => {
  const connectionString = Redacted.value(
    await Effect.runPromise(
      Config.redacted("DATABASE_URL").pipe(Effect.provide(runtimeDatabase))
    )
  );
  const world = createWorld({
    connectionString,
    maxPoolSize: 5,
    queueConcurrency: 1,
    namespace: "roleproof",
    jobPrefix: "roleproof_",
    applicationManagedShutdown: true,
  });
  const received = Promise.withResolvers<unknown>();
  const handle = world.createQueueHandler(
    "__roleproof_wkf_workflow_",
    async (message) => {
      received.resolve(message);
    }
  );
  const server = createServer((request, response) => {
    const run = async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request)
        chunks.push(Schema.decodeUnknownSync(Schema.Uint8Array)(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const result = await handle(
        new Request("http://localhost/queue", {
          method: "POST",
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
      response.writeHead(result.status);
      response.end(await result.text());
    };
    void run().catch(() => {
      received.reject(new Error("Native queue HTTP delivery failed"));
      response.writeHead(500);
      response.end();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = Schema.decodeUnknownSync(
      Schema.Struct({ port: Schema.Number })
    )(address).port;
    vi.stubEnv("WORKFLOW_LOCAL_BASE_URL", `http://127.0.0.1:${String(port)}`);
    const payload = {
      __healthCheck: true as const,
      correlationId: randomUUID(),
    };
    await world.queue("__roleproof_wkf_workflow_probe", payload);
    expect(
      await Effect.runPromise(
        Effect.tryPromise(() => received.promise).pipe(
          Effect.timeout("15 seconds")
        )
      )
    ).toEqual(payload);
  } finally {
    await world.close?.();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    vi.unstubAllEnvs();
  }
});

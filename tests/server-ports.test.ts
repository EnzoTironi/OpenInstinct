import { createServer } from "node:net";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { requireServerPort } from "../scripts/server-ports";

test("startup rejects a busy port without disturbing its existing owner, then accepts it after close", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = Schema.decodeUnknownSync(
    Schema.Struct({ port: Schema.Number })
  )(server.address());
  try {
    await expect(
      Effect.runPromise(requireServerPort("127.0.0.1", port))
    ).rejects.toThrow("unavailable");
    expect(server.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  await expect(
    Effect.runPromise(requireServerPort("127.0.0.1", port))
  ).resolves.toBeUndefined();
});

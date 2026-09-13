import { createServer } from "node:net";
import { Effect, Schema } from "effect";

class ServerPortUnavailable extends Schema.TaggedError<ServerPortUnavailable>()(
  "ServerPortUnavailable",
  { message: Schema.String }
) {}

/** Refuse an occupied port before a health check can mistake another process for Eve. */
export const requireServerPort = Effect.fn("requireServerPort")(function* (
  hostname: string,
  port: number
) {
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createServer()),
    (server) =>
      Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen({ host: hostname, port, exclusive: true }, resolve);
          }),
        catch: () =>
          new ServerPortUnavailable({
            message: `Port ${String(port)} on ${hostname} is unavailable. Stop its owner or choose another port.`,
          }),
      }),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve();
            });
          })
      )
  );
});

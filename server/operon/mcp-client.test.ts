import { Config, ConfigProvider, Effect, Option } from "effect";
import { expect, it } from "vitest";

import { OperonMcpClient, OperonMcpClientStdio } from "./mcp-client";

it("does keep Consumer stdio unavailable without OPERON_HOME", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* OperonMcpClient;
      return yield* client
        .call("operon_derive_identity_keys", {
          email: "bruno@gmail.com",
        })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(OperonMcpClientStdio),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({})
      )
    )
  );
  expect(error.error).toBe("OperonUnavailable");
});

it("does derive identity keys over stdio when OPERON_HOME is linked", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const home = yield* Config.option(Config.string("OPERON_HOME"));
      if (Option.isNone(home)) return { skipped: true as const };
      const client = yield* OperonMcpClient;
      const derived = yield* client.call("operon_derive_identity_keys", {
        email: "bruno@gmail.com",
      });
      return { body: derived.body, skipped: false as const };
    }).pipe(Effect.provide(OperonMcpClientStdio))
  );
  if (result.skipped) return;
  expect(result.body).toMatchObject({
    organization: { domain: "gmail.com", status: "suppressed" },
  });
});

import { ConfigProvider, Effect } from "effect";
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

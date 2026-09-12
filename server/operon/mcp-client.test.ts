import { ConfigProvider, Effect } from "effect";
import { expect, it } from "vitest";

import {
  OPERON_PIN_REPO,
  OPERON_PIN_SHA,
  OperonBuilder,
  OperonBuilderStdio,
  OperonMcpClient,
  OperonMcpClientStdio,
} from "./mcp-client";

it("does pin Consumer stdio to EnzoTironi/operon 59712bd", () => {
  expect(OPERON_PIN_REPO).toBe("EnzoTironi/operon");
  expect(OPERON_PIN_SHA).toBe("59712bd");
});

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

it("does keep Builder off by default", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const builder = yield* OperonBuilder;
      return yield* builder
        .call("operon_admit_mapping_proposal", {
          proposalId: "proposta-1",
        })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(OperonBuilderStdio),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({})
      )
    )
  );
  expect(error.error).toBe("OperonUnavailable");
});

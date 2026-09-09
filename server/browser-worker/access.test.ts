import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { accessScopeForUser } from "@shared/identity/access-scope";
import type { SessionAuthContext } from "eve/context";
import { BrowserWorkerAccess } from "./index";
import { BrowserWorkerAccessError } from "./access";

describe("BrowserWorkerAccess live authority", () => {
  it("maps revoke and pause failures at the service boundary", async () => {
    const principal = channelPrincipal();

    const revoked = await runAuthorize(
      principal,
      Layer.succeed(BrowserWorkerAccess, {
        authorize: () =>
          Effect.fail(new BrowserWorkerAccessError({ reason: "revoked" })),
      })
    );
    expect(revoked).toEqual(
      new BrowserWorkerAccessError({ reason: "revoked" })
    );

    const paused = await runAuthorize(
      principal,
      Layer.succeed(BrowserWorkerAccess, {
        authorize: () =>
          Effect.fail(new BrowserWorkerAccessError({ reason: "paused" })),
      })
    );
    expect(paused).toEqual(new BrowserWorkerAccessError({ reason: "paused" }));
  });
});

function channelPrincipal(): SessionAuthContext {
  const scope = accessScopeForUser("better-auth:alice");
  return {
    attributes: {
      channelIdentityId: "11111111-1111-4111-8111-111111111111",
      conversationChannel: "telegram",
      conversationId: "11111111-1111-4111-8111-111111111111",
      workspaceId: scope.workspaceId,
    },
    authenticator: "verified-channel",
    principalId: scope.userId,
    principalType: "user",
  };
}

async function runAuthorize(
  principal: SessionAuthContext,
  layer: Layer.Layer<BrowserWorkerAccess>
) {
  const runtime = ManagedRuntime.make(layer);
  return runtime.runPromise(
    Effect.gen(function* () {
      const access = yield* BrowserWorkerAccess;
      return yield* access.authorize(principal).pipe(Effect.flip);
    })
  );
}

import { symmetricDecodeJWT, symmetricEncodeJWT } from "better-auth/crypto";
import { Effect, Schema } from "effect";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { applicationOrigin } from "@shared/environment/origin";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  GoogleWorkspaceError,
  requireGoogleWorkspaceMembership,
} from "./index";

const purpose = "companion-google-workspace-link";
const flowSchema = Schema.Struct({
  userId: Schema.NonEmptyString,
  callbackURL: Schema.String,
});

export const validateGoogleCallback = Effect.fn("validateGoogleCallback")(
  function* (callbackURL: string, origin: string) {
    const url = yield* Effect.try({
      try: () => new URL(callbackURL),
      catch: () => new GoogleWorkspaceError({ reason: "invalid_callback" }),
    });
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/eve\/v1\/connections\/[^/]+\/callback\/[^/]+\/[^/]+$/u.test(
        url.pathname
      )
    ) {
      return yield* new GoogleWorkspaceError({ reason: "invalid_callback" });
    }
    return url.href;
  }
);

export const createGoogleWorkspaceChallenge = Effect.fn(
  "createGoogleWorkspaceChallenge"
)(function* (scope: AccessScope, callbackUrl: string) {
  const userId = yield* requireGoogleWorkspaceMembership(scope);
  const callbackURL = yield* validateGoogleCallback(
    callbackUrl,
    applicationOrigin()
  );
  const flow = yield* Effect.tryPromise({
    try: async () =>
      symmetricEncodeJWT(
        { userId, callbackURL },
        (await getInstallationSecrets()).betterAuthSecret,
        purpose,
        600
      ),
    catch: () => new GoogleWorkspaceError({ reason: "unavailable" }),
  });
  const url = new URL("/api/google-workspace/connect", applicationOrigin());
  url.searchParams.set("flow", flow);
  return url.href;
});

export const readGoogleWorkspaceChallenge = Effect.fn(
  "readGoogleWorkspaceChallenge"
)(function* (flow: string, userId: string) {
  const payload = yield* Effect.tryPromise({
    try: async () =>
      symmetricDecodeJWT<unknown>(
        flow,
        (await getInstallationSecrets()).betterAuthSecret,
        purpose
      ),
    catch: () => new GoogleWorkspaceError({ reason: "invalid_callback" }),
  });
  const decoded = yield* Schema.decodeUnknownEffect(flowSchema)(payload).pipe(
    Effect.mapError(
      () => new GoogleWorkspaceError({ reason: "invalid_callback" })
    )
  );
  if (decoded.userId !== userId)
    return yield* new GoogleWorkspaceError({ reason: "unauthenticated" });
  return yield* validateGoogleCallback(
    decoded.callbackURL,
    applicationOrigin()
  );
});

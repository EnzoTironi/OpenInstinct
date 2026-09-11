import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { applicationOrigin } from "@shared/environment/origin";
import { symmetricDecodeJWT, symmetricEncodeJWT } from "better-auth/crypto";
import { Effect, Redacted, Schema } from "effect";
import type { SessionAuthContext } from "eve/context";

import { BrowserWorkerAccess } from "../browser-worker";
import type { BrowserWorkerAccessError } from "../browser-worker/access";
import { GoogleWorkspaceError, googleWorkspaceUserId } from "./index";

const purpose = "companion-google-workspace-link";

const flowSchema = Schema.Struct({
  userId: Schema.NonEmptyString,
  callbackURL: Schema.String,
});

const decodeEffect_flowSchema = Schema.decodeUnknownEffect(flowSchema);

function denyWithoutLiveAuthority(error: BrowserWorkerAccessError) {
  return new GoogleWorkspaceError({
    reason: error.reason === "unavailable" ? "unavailable" : "unauthenticated",
  });
}

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

/**
 * Issues a native Google consent handoff only when the caller still has live
 * delegated authority (channel/web/schedule), not workspace ownership alone.
 */
export const createGoogleWorkspaceChallenge = Effect.fn(
  "createGoogleWorkspaceChallenge"
)(function* (principal: SessionAuthContext, callbackUrl: string) {
  const access = yield* BrowserWorkerAccess;

  const scope = yield* access
    .authorize(principal)
    .pipe(Effect.mapError(denyWithoutLiveAuthority));

  const userId = yield* googleWorkspaceUserId(scope);

  const callbackURL = yield* validateGoogleCallback(
    callbackUrl,
    applicationOrigin()
  );

  const secrets = yield* ResolvedInstallationSecrets;

  const flow = yield* Effect.tryPromise({
    try: () =>
      symmetricEncodeJWT(
        { userId, callbackURL },
        Redacted.value(secrets.betterAuthSecret),
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
  const secrets = yield* ResolvedInstallationSecrets;

  const payload = yield* Effect.tryPromise({
    try: () =>
      symmetricDecodeJWT<unknown>(
        flow,
        Redacted.value(secrets.betterAuthSecret),
        purpose
      ),
    catch: () => new GoogleWorkspaceError({ reason: "invalid_callback" }),
  });

  const decoded = yield* decodeEffect_flowSchema(payload).pipe(
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

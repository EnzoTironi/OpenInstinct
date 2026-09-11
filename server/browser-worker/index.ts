import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import type { SessionAuthContext } from "eve/context";

import { accessScopeForUser } from "../../shared/identity/access-scope";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import {
  BrowserWorkerAccessError,
  requireBrowserWorkerChannelIdentity,
  requireBrowserWorkerLease,
  requireBrowserWorkerMembership,
  requireBrowserWorkerScheduleActive,
  requireBrowserWorkerWebSession,
} from "./access";

const identifier = Schema.NonEmptyString.check(Schema.isTrimmed());

const decodeIdentifier = Schema.decodeUnknownEffect(identifier);

const decodeSchema_String_check_Schema_isUUID = Schema.decodeUnknownEffect(
  Schema.String.check(Schema.isUUID())
);

const authorize = Effect.fn("BrowserWorkerAccess.authorize")(
  function* (principal: SessionAuthContext) {
    if (principal.principalType !== "user")
      return yield* new BrowserWorkerAccessError({
        reason: "unauthenticated",
      });

    const scope = yield* Effect.try({
      try: () => scopeFromPrincipal(principal),
      catch: () => new BrowserWorkerAccessError({ reason: "unauthenticated" }),
    });

    const canonical = accessScopeForUser(scope.userId);

    if (canonical.workspaceId !== scope.workspaceId)
      return yield* new BrowserWorkerAccessError({
        reason: "unauthenticated",
      });

    if (principal.authenticator === "scheduled-worker") {
      const runId = yield* decodeIdentifier(
        principal.attributes.scheduledRunId
      ).pipe(
        Effect.mapError(
          () => new BrowserWorkerAccessError({ reason: "lease_inactive" })
        )
      );

      const leaseToken = yield* decodeIdentifier(
        principal.attributes.scheduledRunLeaseToken
      ).pipe(
        Effect.mapError(
          () => new BrowserWorkerAccessError({ reason: "lease_inactive" })
        )
      );

      yield* requireBrowserWorkerLease(scope, runId, leaseToken);
      const scheduleId = principal.attributes.scheduleId;

      if (scheduleId !== undefined) {
        const id = yield* decodeIdentifier(scheduleId).pipe(
          Effect.mapError(
            () => new BrowserWorkerAccessError({ reason: "paused" })
          )
        );

        yield* requireBrowserWorkerScheduleActive(scope, id);
      }
    }

    if (
      principal.authenticator === "verified-channel" ||
      Schema.is(channelProviderSchema)(principal.attributes.conversationChannel)
    ) {
      const identityId = yield* decodeSchema_String_check_Schema_isUUID(
        principal.attributes.channelIdentityId
      ).pipe(
        Effect.mapError(
          () => new BrowserWorkerAccessError({ reason: "revoked" })
        )
      );

      yield* requireBrowserWorkerChannelIdentity(scope, identityId);
    } else if (principal.authenticator === "authjs") {
      const sessionId = yield* decodeIdentifier(
        principal.attributes.authSessionId
      ).pipe(
        Effect.mapError(
          () => new BrowserWorkerAccessError({ reason: "unauthenticated" })
        )
      );

      yield* requireBrowserWorkerWebSession(scope, sessionId);
    } else if (principal.authenticator !== "scheduled-worker") {
      yield* requireBrowserWorkerMembership(scope);
    }

    return scope;
  },
  Effect.catchTag(
    "SqlError",
    () => new BrowserWorkerAccessError({ reason: "unavailable" })
  )
);

const makeBrowserWorkerAccess = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;

  return {
    authorize: (principal: SessionAuthContext) =>
      authorize(principal).pipe(Effect.provideService(PgClient.PgClient, sql)),
  };
});

export class BrowserWorkerAccess extends Context.Service<
  BrowserWorkerAccess,
  Effect.Success<typeof makeBrowserWorkerAccess>
>()("companion/BrowserWorkerAccess") {
  static readonly layer = Layer.effect(
    BrowserWorkerAccess,
    makeBrowserWorkerAccess
  );
}

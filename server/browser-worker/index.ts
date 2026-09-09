import { Context, Effect, Layer, Schema } from "effect";
import type { SessionAuthContext } from "eve/context";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import {
  accessScopeForUser,
  type AccessScope,
} from "../../shared/identity/access-scope";
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

const authorize = Effect.fn("BrowserWorkerAccess.authorize")(
  function* (principal: SessionAuthContext) {
    if (principal.principalType !== "user")
      return yield* new BrowserWorkerAccessError({
        reason: "unauthenticated",
      });
    const scope = yield* Effect.try({
      try: () => scopeFromPrincipal(principal),
      catch: () =>
        new BrowserWorkerAccessError({ reason: "unauthenticated" }),
    });
    const canonical = accessScopeForUser(scope.userId);
    if (canonical.workspaceId !== scope.workspaceId)
      return yield* new BrowserWorkerAccessError({
        reason: "unauthenticated",
      });

    if (principal.authenticator === "scheduled-worker") {
      const runId = yield* Schema.decodeUnknownEffect(identifier)(
        principal.attributes.scheduledRunId
      ).pipe(
        Effect.mapError(
          () => new BrowserWorkerAccessError({ reason: "lease_inactive" })
        )
      );
      const leaseToken = yield* Schema.decodeUnknownEffect(identifier)(
        principal.attributes.scheduledRunLeaseToken
      ).pipe(
        Effect.mapError(
          () => new BrowserWorkerAccessError({ reason: "lease_inactive" })
        )
      );
      yield* requireBrowserWorkerLease(scope, runId, leaseToken);
      const scheduleId = principal.attributes.scheduleId;
      if (scheduleId !== undefined) {
        const id = yield* Schema.decodeUnknownEffect(identifier)(
          scheduleId
        ).pipe(
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
      const identityId = yield* Schema.decodeUnknownEffect(
        Schema.String.check(Schema.isUUID())
      )(principal.attributes.channelIdentityId).pipe(
        Effect.mapError(
          () => new BrowserWorkerAccessError({ reason: "revoked" })
        )
      );
      yield* requireBrowserWorkerChannelIdentity(scope, identityId);
    } else if (principal.authenticator === "authjs") {
      const sessionId = yield* Schema.decodeUnknownEffect(identifier)(
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

export class BrowserWorkerAccess extends Context.Service<
  BrowserWorkerAccess,
  {
    readonly authorize: (
      principal: SessionAuthContext
    ) => Effect.Effect<AccessScope, BrowserWorkerAccessError>;
  }
>()("companion/BrowserWorkerAccess") {
  static readonly layer = Layer.succeed(BrowserWorkerAccess, { authorize });
}

export { BrowserWorkerAccessError } from "./access";

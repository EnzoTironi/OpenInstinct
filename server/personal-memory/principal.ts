import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type { SessionAuthContext } from "eve/context";

import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { requireChannelPrincipal } from "../channels/principal";
import {
  PersonalMemoryError,
  requirePersonalMemoryMembership,
  requirePersonalMemoryWebSession,
} from "./access";

const decodeChannelProviderSchema = Schema.decodeUnknownEffect(
  channelProviderSchema
);

const decodeNonEmptyString = Schema.decodeUnknownEffect(Schema.NonEmptyString);

const personalMemoryUnauthenticated = () =>
  new PersonalMemoryError({ reason: "unauthenticated" });

const personalMemoryUnavailable = () =>
  new PersonalMemoryError({ reason: "unavailable" });

const isUserPrincipal = (
  principal: SessionAuthContext | null
): principal is SessionAuthContext & { readonly principalType: "user" } =>
  principal?.principalType === "user";

const isChannelMemoryPrincipal = (principal: SessionAuthContext) =>
  principal.authenticator === "verified-channel" ||
  Schema.is(channelProviderSchema)(principal.attributes.conversationChannel);

const scopeFromUserPrincipal = (principal: SessionAuthContext) =>
  Effect.try({
    try: () => scopeFromPrincipal(principal),
    catch: personalMemoryUnauthenticated,
  });

const authorizeChannelMemoryPrincipal = Effect.fn(
  "authorizeChannelMemoryPrincipal"
)(function* (principal: SessionAuthContext) {
  const channel = yield* decodeChannelProviderSchema(
    principal.attributes.conversationChannel
  ).pipe(Effect.mapError(personalMemoryUnauthenticated));

  const identity = yield* requireChannelPrincipal(channel, principal).pipe(
    Effect.mapError(personalMemoryUnauthenticated)
  );

  const sql = yield* PgClient.PgClient;

  const rows =
    yield* sql`SELECT id FROM channel_identity WHERE id = ${identity.id} AND revoked_at IS NULL FOR SHARE`;

  if (rows.length !== 1) return yield* personalMemoryUnauthenticated();

  return undefined;
});

const requireWebSessionOrMembership = Effect.fn(
  "requireWebSessionOrMembership"
)(function* (
  principal: SessionAuthContext,
  scope: ReturnType<typeof scopeFromPrincipal>
) {
  if (principal.authenticator !== "authjs") {
    yield* requirePersonalMemoryMembership(scope);

    return undefined;
  }

  const sessionId = yield* decodeNonEmptyString(
    principal.attributes.authSessionId
  ).pipe(Effect.mapError(personalMemoryUnauthenticated));

  yield* requirePersonalMemoryWebSession(scope, sessionId);

  return undefined;
});

// Storage callers keep these authority locks in the same transaction as document I/O.
export const authorizePersonalMemoryPrincipal = Effect.fn(
  "authorizePersonalMemoryPrincipal"
)(
  function* (principal: SessionAuthContext | null) {
    if (!isUserPrincipal(principal))
      return yield* personalMemoryUnauthenticated();

    const scope = yield* scopeFromUserPrincipal(principal);

    if (isChannelMemoryPrincipal(principal))
      yield* authorizeChannelMemoryPrincipal(principal);

    yield* requireWebSessionOrMembership(principal, scope);

    return scope;
  },
  Effect.catchTag("SqlError", personalMemoryUnavailable)
);

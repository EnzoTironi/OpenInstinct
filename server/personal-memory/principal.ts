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

// Storage callers keep these authority locks in the same transaction as document I/O.
export const authorizePersonalMemoryPrincipal = Effect.fn(
  "authorizePersonalMemoryPrincipal"
)(
  function* (principal: SessionAuthContext | null) {
    if (principal?.principalType !== "user")
      return yield* new PersonalMemoryError({ reason: "unauthenticated" });

    const scope = yield* Effect.try({
      try: () => scopeFromPrincipal(principal),
      catch: () => new PersonalMemoryError({ reason: "unauthenticated" }),
    });

    if (
      principal.authenticator === "verified-channel" ||
      Schema.is(channelProviderSchema)(principal.attributes.conversationChannel)
    ) {
      const channel = yield* decodeChannelProviderSchema(
        principal.attributes.conversationChannel
      ).pipe(
        Effect.mapError(
          () => new PersonalMemoryError({ reason: "unauthenticated" })
        )
      );

      const identity = yield* requireChannelPrincipal(channel, principal).pipe(
        Effect.mapError(
          () => new PersonalMemoryError({ reason: "unauthenticated" })
        )
      );

      const sql = yield* PgClient.PgClient;

      const rows =
        yield* sql`SELECT id FROM channel_identity WHERE id = ${identity.id} AND revoked_at IS NULL FOR SHARE`;

      if (rows.length !== 1)
        return yield* new PersonalMemoryError({ reason: "unauthenticated" });
    }

    if (principal.authenticator === "authjs") {
      const sessionId = yield* decodeNonEmptyString(
        principal.attributes.authSessionId
      ).pipe(
        Effect.mapError(
          () => new PersonalMemoryError({ reason: "unauthenticated" })
        )
      );

      yield* requirePersonalMemoryWebSession(scope, sessionId);
    } else yield* requirePersonalMemoryMembership(scope);

    return scope;
  },
  Effect.catchTag(
    "SqlError",
    () => new PersonalMemoryError({ reason: "unavailable" })
  )
);

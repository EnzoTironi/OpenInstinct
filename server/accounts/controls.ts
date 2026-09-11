import { readAuthSession } from "@db/services/auth/session";
import { PgClient } from "@effect/sql-pg";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { Effect, Schema, Match } from "effect";

import { ChannelAccounts, IdentitySchema } from "./index";

class AccountControlError extends Schema.TaggedError<AccountControlError>()(
  "AccountControlError",
  {
    reason: Schema.Literals([
      "unauthenticated",
      "identity_inactive",
      "unavailable",
    ]),
  }
) {}

const linkedIdentitySchema = Schema.Struct({
  id: IdentitySchema.fields.id,
  channel: IdentitySchema.fields.channel,
  senderId: IdentitySchema.fields.senderId,
});
const decodeSchema_Array_linkedIdentitySchema = Schema.decodeUnknownEffect(Schema.Array(linkedIdentitySchema));
const decodeId = Schema.decodeUnknownEffect(IdentitySchema.fields.id);

const requireControlSession = Effect.fn("requireControlSession")(function* (
  headers: Headers
) {
  const session = yield* readAuthSession(headers);

  if (!session)
    return yield* new AccountControlError({ reason: "unauthenticated" });
  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  const sql = yield* PgClient.PgClient;

  const rows = yield* sql`
    SELECT s.id FROM public.session s
    INNER JOIN workspace_memberships m ON m.user_id = ${scope.userId} AND m.workspace_id = ${scope.workspaceId}
    WHERE s.id = ${session.session.id} AND s."userId" = ${session.user.id} AND s."expiresAt" > clock_timestamp()`;

  if (rows.length !== 1)
    return yield* new AccountControlError({ reason: "unauthenticated" });

  return session;
});

export const readLinkedChannelIdentities = Effect.fn(
  "readLinkedChannelIdentities"
)(
  function* (headers: Headers) {
    const session = yield* requireControlSession(headers);
    const sql = yield* PgClient.PgClient;

    const rows =
      yield* sql`SELECT id, channel, sender_id AS "senderId" FROM public.channel_identity WHERE user_id = ${session.user.id} AND revoked_at IS NULL ORDER BY channel, created_at, id`;

    return yield* decodeSchema_Array_linkedIdentitySchema(rows);
  },
  Effect.catchTag(
    ["AuthUnavailable", "SqlError", "SchemaError"],
    () => new AccountControlError({ reason: "unavailable" })
  )
);

export const revokeLinkedChannelIdentity = Effect.fn(
  "revokeLinkedChannelIdentity"
)(
  function* (headers: Headers, identityId: string) {
    const id = yield* decodeId(
      identityId
    ).pipe(
      Effect.mapError(
        () => new AccountControlError({ reason: "identity_inactive" })
      )
    );

    const session = yield* requireControlSession(headers);
    const accounts = yield* ChannelAccounts;

    return yield* accounts
      .revokeIdentity({ identityId: id, userId: session.user.id })
      .pipe(
        Effect.as({ status: "revoked" as const }),
        Effect.catchTag("ChannelAccountError", (error) => {
          if (error.reason === "last_access")
            return Effect.succeed({ status: "last_access" as const });

          return new AccountControlError({
            reason: Match.value(error.reason).pipe(
              Match.when(
                "identity_inactive",
                () => "identity_inactive" as const
              ),
              Match.when("session_invalid", () => "unauthenticated" as const),
              Match.orElse(() => "unavailable" as const)
            ),
          });
        })
      );
  },
  Effect.catchTag(
    ["AuthUnavailable", "SqlError"],
    () => new AccountControlError({ reason: "unavailable" })
  )
);

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { accessScopeForUser } from "../../shared/identity/access-scope.ts";

const Identifier = Schema.NonEmptyString.check(Schema.isTrimmed());
const Uuid = Schema.String.check(Schema.isUUID());
const Secret = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));
const Channel = Schema.Literals(["telegram", "kapso"]);
export const VerifiedSender = Schema.Struct({
  channel: Channel,
  installationId: Identifier,
  senderId: Identifier,
});
export const IssueChallenge = Schema.Struct({
  channel: Channel,
  installationId: Identifier,
  browserSecret: Secret,
  link: Schema.optionalKey(
    Schema.Struct({ userId: Identifier, sessionId: Identifier })
  ),
});
export const ConfirmChallenge = Schema.Struct({
  token: Secret,
  sender: VerifiedSender,
});
export const ConsumeChallenge = Schema.Struct({
  challengeId: Uuid,
  browserSecret: Secret,
  currentSessionId: Schema.optionalKey(Identifier),
});
export const RevokeIdentity = Schema.Struct({
  identityId: Uuid,
  userId: Identifier,
});

export class ChannelAccountError extends Schema.TaggedError<ChannelAccountError>()(
  "ChannelAccountError",
  {
    reason: Schema.Literals([
      "invalid_input",
      "identity_inactive",
      "invalid_challenge",
      "account_conflict",
      "session_invalid",
      "last_access",
    ]),
  }
) {}

export interface Identity {
  readonly id: string;
  readonly userId: string;
  readonly channel: "telegram" | "kapso";
  readonly installationId: string;
  readonly senderId: string;
}
interface IdentityRow extends Identity {
  readonly revoked: boolean;
}
interface ChallengeRow {
  readonly id: string;
  readonly purpose: "login" | "link";
  readonly channel: "telegram" | "kapso";
  readonly installationId: string;
  readonly targetUserId: string | null;
  readonly requestingSessionId: string | null;
  readonly identityId: string | null;
}
type Failure = ChannelAccountError | SqlError;
interface Accounts {
  readonly resolveVerifiedSender: (
    input: typeof VerifiedSender.Type
  ) => Effect.Effect<Identity, Failure>;
  readonly getActiveIdentity: (
    input: typeof VerifiedSender.Type
  ) => Effect.Effect<Identity, Failure>;
  readonly issueChallenge: (
    input: typeof IssueChallenge.Type
  ) => Effect.Effect<{ challengeId: string; token: string }, Failure>;
  readonly confirmChallenge: (
    input: typeof ConfirmChallenge.Type
  ) => Effect.Effect<{ challengeId: string }, Failure>;
  readonly consumeChallenge: (
    input: typeof ConsumeChallenge.Type
  ) => Effect.Effect<
    {
      userId: string;
      identityId: string;
      principalId: string;
      workspaceId: string;
    },
    Failure
  >;
  readonly revokeIdentity: (
    input: typeof RevokeIdentity.Type
  ) => Effect.Effect<void, Failure>;
}
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
const fail = (reason: ChannelAccountError["reason"]) =>
  new ChannelAccountError({ reason });
const decode = <S extends Schema.Constraint>(schema: S, input: S["Type"]) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => fail("invalid_input"))
  );
const publicIdentity = ({
  id,
  userId,
  channel,
  installationId,
  senderId,
}: Identity): Identity => ({ id, userId, channel, installationId, senderId });

/** Transport verification and explicit channel confirmation belong to the caller. */
export class ChannelAccounts extends Context.Service<
  ChannelAccounts,
  Accounts
>()("companion/ChannelAccounts") {
  static readonly layer = Layer.effect(
    ChannelAccounts,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      // All account lifecycle writers take this lock. Short DB-only transactions
      // serialize revocation against confirmation/consumption, including first contact.
      const transaction = <A, E>(effect: Effect.Effect<A, E>) =>
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(724193, 1)`;
            return yield* effect;
          })
        );
      const findIdentity = Effect.fn("ChannelAccounts.findIdentity")(function* (
        sender: typeof VerifiedSender.Type
      ) {
        const rows =
          yield* sql<IdentityRow>`SELECT id, user_id AS "userId", channel,
        installation_id AS "installationId", sender_id AS "senderId", revoked_at IS NOT NULL AS revoked
        FROM public.channel_identity WHERE channel = ${sender.channel}
        AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}`;
        return rows[0];
      });
      const requireSession = Effect.fn("ChannelAccounts.requireSession")(
        function* (userId: string, sessionId: string) {
          const rows =
            yield* sql`SELECT id FROM public.session WHERE id = ${sessionId}
        AND "userId" = ${userId} AND "expiresAt" > clock_timestamp() FOR UPDATE`;
          if (!rows.length) return yield* fail("session_invalid");
          return undefined;
        }
      );
      const provision = Effect.fn("ChannelAccounts.provision")(function* (
        sender: typeof VerifiedSender.Type,
        targetUserId?: string
      ) {
        const existing = yield* findIdentity(sender);
        if (existing?.revoked) return yield* fail("identity_inactive");
        if (existing) {
          if (targetUserId && targetUserId !== existing.userId)
            return yield* fail("account_conflict");
          return publicIdentity(existing);
        }
        const userId = targetUserId ?? randomUUID();
        if (!targetUserId)
          yield* sql`INSERT INTO public."user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES (${userId}, 'Companion user', ${`${userId}@accounts.invalid`}, false, clock_timestamp(), clock_timestamp())`;
        const id = randomUUID();
        yield* sql`INSERT INTO public.channel_identity
        (id, channel, installation_id, sender_id, user_id, verified_at, created_at, updated_at)
        VALUES (${id}, ${sender.channel}, ${sender.installationId}, ${sender.senderId}, ${userId},
          clock_timestamp(), clock_timestamp(), clock_timestamp())`;
        return { id, userId, ...sender };
      });
      const resolveVerifiedSender = Effect.fn(
        "ChannelAccounts.resolveVerifiedSender"
      )(function* (input: typeof VerifiedSender.Type) {
        const sender = yield* decode(VerifiedSender, input);
        return yield* transaction(provision(sender));
      });
      const getActiveIdentity = Effect.fn("ChannelAccounts.getActiveIdentity")(
        function* (input: typeof VerifiedSender.Type) {
          const sender = yield* decode(VerifiedSender, input);
          const identity = yield* findIdentity(sender);
          if (!identity || identity.revoked)
            return yield* fail("identity_inactive");
          return publicIdentity(identity);
        }
      );
      const issueChallenge = Effect.fn("ChannelAccounts.issueChallenge")(
        function* (input: typeof IssueChallenge.Type) {
          const request = yield* decode(IssueChallenge, input);
          return yield* transaction(
            Effect.gen(function* () {
              if (request.link)
                yield* requireSession(
                  request.link.userId,
                  request.link.sessionId
                );
              const id = randomUUID();
              const token = randomBytes(32).toString("base64url");
              yield* sql`INSERT INTO public.channel_auth_challenge
          (id, purpose, token_hash, browser_secret_hash, target_user_id, requesting_session_id,
           channel, installation_id, expires_at, created_at)
          VALUES (${id}, ${request.link ? "link" : "login"}, ${hash(token)}, ${hash(request.browserSecret)},
            ${request.link?.userId ?? null}, ${request.link?.sessionId ?? null}, ${request.channel},
            ${request.installationId}, clock_timestamp() + interval '5 minutes', clock_timestamp())`;
              return { challengeId: id, token };
            })
          );
        }
      );
      const confirmChallenge = Effect.fn("ChannelAccounts.confirmChallenge")(
        function* (input: typeof ConfirmChallenge.Type) {
          const request = yield* decode(ConfirmChallenge, input);
          return yield* transaction(
            Effect.gen(function* () {
              const rows =
                yield* sql<ChallengeRow>`SELECT id, purpose, channel, installation_id AS "installationId",
          target_user_id AS "targetUserId", requesting_session_id AS "requestingSessionId", identity_id AS "identityId"
          FROM public.channel_auth_challenge WHERE token_hash = ${hash(request.token)}
          AND consumed_at IS NULL AND cancelled_at IS NULL AND confirmed_at IS NULL
          AND expires_at > clock_timestamp() FOR UPDATE`;
              const challenge = rows[0];
              if (
                !challenge ||
                challenge.channel !== request.sender.channel ||
                challenge.installationId !== request.sender.installationId
              )
                return yield* fail("invalid_challenge");
              if (challenge.purpose === "link") {
                if (!challenge.targetUserId || !challenge.requestingSessionId)
                  return yield* fail("invalid_challenge");
                yield* requireSession(
                  challenge.targetUserId,
                  challenge.requestingSessionId
                );
              }
              const identity = yield* provision(
                request.sender,
                challenge.targetUserId ?? undefined
              );
              yield* sql`UPDATE public.channel_auth_challenge SET identity_id = ${identity.id}, confirmed_at = clock_timestamp()
          WHERE id = ${challenge.id}`;
              return { challengeId: challenge.id };
            })
          );
        }
      );
      const consumeChallenge = Effect.fn("ChannelAccounts.consumeChallenge")(
        function* (input: typeof ConsumeChallenge.Type) {
          const request = yield* decode(ConsumeChallenge, input);
          return yield* transaction(
            Effect.gen(function* () {
              const rows =
                yield* sql<ChallengeRow>`SELECT id, purpose, channel, installation_id AS "installationId",
          target_user_id AS "targetUserId", requesting_session_id AS "requestingSessionId", identity_id AS "identityId"
          FROM public.channel_auth_challenge WHERE id = ${request.challengeId}
          AND browser_secret_hash = ${hash(request.browserSecret)} AND confirmed_at IS NOT NULL
          AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`;
              const challenge = rows[0];
              if (!challenge?.identityId)
                return yield* fail("invalid_challenge");
              if (challenge.purpose === "link") {
                if (
                  !challenge.targetUserId ||
                  !challenge.requestingSessionId ||
                  challenge.requestingSessionId !== request.currentSessionId
                )
                  return yield* fail("session_invalid");
                yield* requireSession(
                  challenge.targetUserId,
                  challenge.requestingSessionId
                );
              }
              const identities = yield* sql<{
                userId: string;
              }>`SELECT user_id AS "userId" FROM public.channel_identity
          WHERE id = ${challenge.identityId} AND revoked_at IS NULL
          AND channel = ${challenge.channel} AND installation_id = ${challenge.installationId}`;
              const identity = identities[0];
              if (!identity) return yield* fail("identity_inactive");
              if (
                challenge.targetUserId &&
                identity.userId !== challenge.targetUserId
              )
                return yield* fail("account_conflict");
              yield* sql`UPDATE public.channel_auth_challenge SET consumed_at = clock_timestamp() WHERE id = ${challenge.id}`;
              const principalId = `better-auth:${identity.userId}`;
              const scope = accessScopeForUser(principalId);
              return {
                userId: identity.userId,
                identityId: challenge.identityId,
                principalId,
                workspaceId: scope.workspaceId,
              };
            })
          );
        }
      );
      const revokeIdentity = Effect.fn("ChannelAccounts.revokeIdentity")(
        function* (input: typeof RevokeIdentity.Type) {
          const request = yield* decode(RevokeIdentity, input);
          yield* transaction(
            Effect.gen(function* () {
              const identities =
                yield* sql`SELECT id FROM public.channel_identity WHERE id = ${request.identityId}
          AND user_id = ${request.userId} AND revoked_at IS NULL FOR UPDATE`;
              if (!identities.length) return yield* fail("identity_inactive");
              const remaining =
                yield* sql`SELECT id FROM public.channel_identity WHERE user_id = ${request.userId}
          AND id <> ${request.identityId} AND revoked_at IS NULL`;
              if (!remaining.length) return yield* fail("last_access");
              yield* sql`UPDATE public.channel_identity SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = ${request.identityId}`;
              yield* sql`UPDATE public.channel_auth_challenge SET cancelled_at = clock_timestamp()
          WHERE consumed_at IS NULL AND cancelled_at IS NULL
          AND (identity_id = ${request.identityId} OR target_user_id = ${request.userId}
            OR requesting_session_id IN (SELECT id FROM public.session WHERE "userId" = ${request.userId}))`;
              yield* sql`DELETE FROM public.session WHERE "userId" = ${request.userId}`;
              return undefined;
            })
          );
        }
      );
      return ChannelAccounts.of({
        resolveVerifiedSender,
        getActiveIdentity,
        issueChallenge,
        confirmChallenge,
        consumeChallenge,
        revokeIdentity,
      });
    })
  );
}

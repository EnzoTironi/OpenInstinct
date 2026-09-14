import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  channelProviderSchema,
  type channelChallengeStatusSchema,
} from "../../shared/identity/channel-auth.ts";
import { accessScopeForUser } from "../../shared/identity/access-scope.ts";
import { ChannelAccountError } from "./errors";
import { archiveChannelAccount } from "./archive-transfer";
export { ChannelAccountError } from "./errors";

const Identifier = Schema.NonEmptyString.check(Schema.isTrimmed());
const Uuid = Schema.String.check(Schema.isUUID());
const Secret = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));

export const VerifiedSender = Schema.Struct({
  channel: channelProviderSchema,
  installationId: Identifier,
  senderId: Identifier,
});
const IssueChallenge = Schema.Union([
  Schema.Struct({
    purpose: Schema.Literal("login"),
    channel: channelProviderSchema,
    installationId: Identifier,
    browserSecret: Secret,
  }),
  Schema.Struct({
    purpose: Schema.Literal("link"),
    channel: channelProviderSchema,
    installationId: Identifier,
    browserSecret: Secret,
    userId: Identifier,
    sessionId: Identifier,
  }),
]);
const ConfirmChallenge = Schema.Struct({
  token: Secret,
  sender: VerifiedSender,
});
const ChallengeStatus = Schema.Struct({
  challengeId: Uuid,
  browserSecret: Secret,
});
const ConsumeChallenge = Schema.Struct({
  challengeId: Uuid,
  browserSecret: Secret,
  currentSessionId: Schema.optionalKey(Identifier),
});
const FreshSession = Schema.Struct({
  userId: Identifier,
  sessionId: Identifier,
});
const RevokeIdentity = Schema.Struct({
  identityId: Uuid,
  userId: Identifier,
});

export const IdentitySchema = Schema.Struct({
  id: Uuid,
  userId: Identifier,
  ...VerifiedSender.fields,
});
export type Identity = typeof IdentitySchema.Type;
const SenderResolutionSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("linked"), identity: IdentitySchema }),
  Schema.Struct({ status: Schema.Literal("unlinked"), sender: VerifiedSender }),
]);
type SenderResolution = typeof SenderResolutionSchema.Type;
const UnlinkedContact = Schema.Struct({ prompt: Schema.Boolean });
const IdentityRow = Schema.Struct({
  ...IdentitySchema.fields,
  revoked: Schema.Boolean,
});
const ChallengeRow = Schema.Struct({
  id: Uuid,
  purpose: Schema.Literals(["login", "link"]),
  channel: channelProviderSchema,
  installationId: Identifier,
  targetUserId: Schema.NullOr(Identifier),
  sourceUserId: Schema.NullOr(Identifier),
  requestingSessionId: Schema.NullOr(Identifier),
  identityId: Schema.NullOr(Uuid),
  confirmedSenderId: Schema.NullOr(Identifier),
});
export const PreviewChallenge = ConfirmChallenge;
const ChallengePreview = Schema.Struct({
  id: Uuid,
  purpose: ChallengeRow.fields.purpose,
  expiresAt: Schema.String,
});
const SessionOwner = Schema.Struct({
  identityId: IdentitySchema.fields.id,
  userId: IdentitySchema.fields.userId,
});
const ConsumedChallenge = Schema.Struct({
  ...SessionOwner.fields,
  purpose: ChallengeRow.fields.purpose,
  principalId: Identifier,
  workspaceId: Identifier,
});
type Failure = ChannelAccountError | SqlError;
interface Accounts {
  readonly requireFreshSession: (
    input: typeof FreshSession.Type
  ) => Effect.Effect<void, Failure>;
  readonly resolveVerifiedSender: (
    input: typeof VerifiedSender.Type
  ) => Effect.Effect<SenderResolution, Failure>;
  readonly recordUnlinkedContact: (
    input: typeof VerifiedSender.Type
  ) => Effect.Effect<typeof UnlinkedContact.Type, Failure>;
  readonly getActiveIdentity: (
    input: typeof VerifiedSender.Type
  ) => Effect.Effect<Identity, Failure>;
  readonly issueChallenge: (
    input: typeof IssueChallenge.Type
  ) => Effect.Effect<
    { challengeId: string; token: string; expiresAt: string },
    Failure
  >;
  readonly previewChallenge: (
    input: typeof PreviewChallenge.Type
  ) => Effect.Effect<typeof ChallengePreview.Type, Failure>;
  readonly confirmChallenge: (
    input: typeof ConfirmChallenge.Type
  ) => Effect.Effect<{ challengeId: string }, Failure>;
  readonly getChallengeStatus: (
    input: typeof ChallengeStatus.Type
  ) => Effect.Effect<typeof channelChallengeStatusSchema.Type, Failure>;
  readonly consumeChallenge: (
    input: typeof ConsumeChallenge.Type
  ) => Effect.Effect<typeof ConsumedChallenge.Type, Failure>;
  readonly withLoginSession: <A, E, R>(
    owner: typeof SessionOwner.Type,
    createSession: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R>;
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

/**
 * Transport verification and explicit channel confirmation belong to the caller.
 * Google sign-in creates the user; a messenger only becomes usable through a
 * consumed link challenge. First contact never creates a user or a workspace.
 */
export class ChannelAccounts extends Context.Service<
  ChannelAccounts,
  Accounts
>()("companion/ChannelAccounts") {
  static readonly layer = Layer.effect(
    ChannelAccounts,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      // All account lifecycle writers take this lock. Short DB-only transactions
      // serialize revocation against confirmation, consumption and pending-sender bookkeeping.
      const transaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(724193, 1)`;
            return yield* effect;
          })
        );
      const findIdentity = Effect.fn("ChannelAccounts.findIdentity")(function* (
        sender: typeof VerifiedSender.Type
      ) {
        const rows = yield* sql<
          typeof IdentityRow.Type
        >`SELECT id, user_id AS "userId", channel,
        installation_id AS "installationId", sender_id AS "senderId", revoked_at IS NOT NULL AS revoked
        FROM public.channel_identity WHERE channel = ${sender.channel}
        AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}
        ORDER BY revoked_at NULLS FIRST, created_at DESC LIMIT 1`;
        return rows[0];
      });
      const requireSession = Effect.fn("ChannelAccounts.requireSession")(
        function* (userId: string, sessionId: string, requireFresh = false) {
          const rows = yield* sql`SELECT s.id FROM public.session s
        JOIN workspace_memberships m ON m.user_id = ${`better-auth:${userId}`} AND m.workspace_id = ${accessScopeForUser(`better-auth:${userId}`).workspaceId}
        WHERE s.id = ${sessionId} AND s."userId" = ${userId} AND s."expiresAt" > clock_timestamp()
        AND (NOT ${requireFresh} OR (s."createdAt" >= clock_timestamp() - interval '10 minutes' AND s."createdAt" <= clock_timestamp())) FOR UPDATE OF s`;
          if (!rows.length) return yield* fail("session_invalid");
          return undefined;
        }
      );
      const requireFreshSession = Effect.fn(
        "ChannelAccounts.requireFreshSession"
      )(function* (input: typeof FreshSession.Type) {
        const request = yield* decode(FreshSession, input);
        return yield* transaction(
          requireSession(request.userId, request.sessionId, true)
        );
      });
      const linkIdentity = Effect.fn("ChannelAccounts.linkIdentity")(function* (
        sender: typeof VerifiedSender.Type,
        userId: string
      ) {
        const existing = yield* findIdentity(sender);
        if (existing?.revoked) return yield* fail("identity_inactive");
        if (existing) {
          if (existing.userId !== userId)
            return yield* fail("account_conflict");
          return publicIdentity(existing);
        }
        const id = randomUUID();
        yield* sql`INSERT INTO public.channel_identity
        (id, channel, installation_id, sender_id, user_id, verified_at, created_at, updated_at)
        VALUES (${id}, ${sender.channel}, ${sender.installationId}, ${sender.senderId}, ${userId},
          clock_timestamp(), clock_timestamp(), clock_timestamp())`;
        yield* sql`DELETE FROM public.channel_pending_sender WHERE channel = ${sender.channel}
        AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}`;
        return { id, userId, ...sender };
      });
      const requireLinkedIdentity = Effect.fn(
        "ChannelAccounts.requireLinkedIdentity"
      )(function* (sender: typeof VerifiedSender.Type) {
        const existing = yield* findIdentity(sender);
        if (!existing) return yield* fail("sender_unlinked");
        if (existing.revoked) return yield* fail("identity_inactive");
        return publicIdentity(existing);
      });
      const resolveVerifiedSender = Effect.fn(
        "ChannelAccounts.resolveVerifiedSender"
      )(function* (input: typeof VerifiedSender.Type) {
        const sender = yield* decode(VerifiedSender, input);
        const existing = yield* findIdentity(sender);
        if (existing?.revoked) return yield* fail("identity_inactive");
        if (existing)
          return {
            status: "linked" as const,
            identity: publicIdentity(existing),
          };
        return { status: "unlinked" as const, sender };
      });
      const recordUnlinkedContact = Effect.fn(
        "ChannelAccounts.recordUnlinkedContact"
      )(function* (input: typeof VerifiedSender.Type) {
        const sender = yield* decode(VerifiedSender, input);
        return yield* transaction(
          Effect.gen(function* () {
            // now() is transaction-stable, so the RETURNING comparison is exact.
            const rows = yield* sql<typeof UnlinkedContact.Type>`
              INSERT INTO public.channel_pending_sender
                (channel, installation_id, sender_id, first_seen_at, last_seen_at, contact_count, prompted_at)
              SELECT ${sender.channel}, ${sender.installationId}, ${sender.senderId}, now(), now(), 1, now()
              WHERE NOT EXISTS (SELECT 1 FROM public.channel_identity WHERE channel = ${sender.channel}
                AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId})
              ON CONFLICT (channel, installation_id, sender_id) DO UPDATE SET
                last_seen_at = now(),
                contact_count = public.channel_pending_sender.contact_count + 1,
                prompted_at = CASE WHEN public.channel_pending_sender.prompted_at IS NULL
                  OR public.channel_pending_sender.prompted_at <= now() - interval '24 hours' THEN now()
                  ELSE public.channel_pending_sender.prompted_at END
              RETURNING (prompted_at = now()) AS prompt`;
            const contact = rows[0];
            if (!contact) return { prompt: false };
            return yield* decode(UnlinkedContact, contact);
          })
        );
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
              if (request.purpose === "link")
                yield* requireSession(request.userId, request.sessionId, true);
              const id = randomUUID();
              const token = randomBytes(32).toString("base64url");
              const targetUserId =
                request.purpose === "link" ? request.userId : null;
              const requestingSessionId =
                request.purpose === "link" ? request.sessionId : null;
              const issued = yield* sql<{
                expiresAt: string;
              }>`INSERT INTO public.channel_auth_challenge
          (id, purpose, token_hash, browser_secret_hash, target_user_id, requesting_session_id,
           channel, installation_id, expires_at, created_at)
          VALUES (${id}, ${request.purpose}, ${hash(token)}, ${hash(request.browserSecret)},
            ${targetUserId}, ${requestingSessionId}, ${request.channel},
            ${request.installationId}, clock_timestamp() + interval '5 minutes', clock_timestamp())
          RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"`;
              const expiry = issued[0];
              if (!expiry) return yield* fail("invalid_challenge");
              return { challengeId: id, token, expiresAt: expiry.expiresAt };
            })
          );
        }
      );
      const previewChallenge = Effect.fn("ChannelAccounts.previewChallenge")(
        function* (input: typeof PreviewChallenge.Type) {
          const request = yield* decode(PreviewChallenge, input);
          return yield* transaction(
            Effect.gen(function* () {
              const rows = yield* sql<
                typeof ChallengePreview.Type &
                  Pick<
                    typeof ChallengeRow.Type,
                    "targetUserId" | "requestingSessionId"
                  >
              >`
              SELECT id, purpose, target_user_id AS "targetUserId", requesting_session_id AS "requestingSessionId",
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"
              FROM public.channel_auth_challenge
              WHERE token_hash = ${hash(request.token)} AND channel = ${request.sender.channel}
              AND installation_id = ${request.sender.installationId}
              AND intended_identity_id IS NULL
              AND confirmed_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL
              AND expires_at > clock_timestamp()`;
              const preview = rows[0];
              if (!preview) return yield* fail("invalid_challenge");
              const existing = yield* findIdentity(request.sender);
              if (existing?.revoked) return yield* fail("identity_inactive");
              if (preview.purpose === "login" && !existing)
                return yield* fail("sender_unlinked");
              if (preview.purpose === "link") {
                if (!preview.targetUserId || !preview.requestingSessionId)
                  return yield* fail("invalid_challenge");
                yield* requireSession(
                  preview.targetUserId,
                  preview.requestingSessionId,
                  true
                );
                if (existing && existing.userId !== preview.targetUserId)
                  return yield* fail("account_conflict");
              }
              return {
                id: preview.id,
                purpose: preview.purpose,
                expiresAt: preview.expiresAt,
              };
            })
          );
        }
      );
      const confirmChallenge = Effect.fn("ChannelAccounts.confirmChallenge")(
        function* (input: typeof ConfirmChallenge.Type) {
          const request = yield* decode(ConfirmChallenge, input);
          return yield* transaction(
            Effect.gen(function* () {
              const rows = yield* sql<
                typeof ChallengeRow.Type
              >`SELECT id, purpose, channel, installation_id AS "installationId",
          target_user_id AS "targetUserId", source_user_id AS "sourceUserId", requesting_session_id AS "requestingSessionId", identity_id AS "identityId", confirmed_sender_id AS "confirmedSenderId"
          FROM public.channel_auth_challenge WHERE token_hash = ${hash(request.token)}
          AND intended_identity_id IS NULL
          AND consumed_at IS NULL AND cancelled_at IS NULL
          AND expires_at > clock_timestamp() FOR UPDATE`;
              const challenge = rows[0];
              if (
                !challenge ||
                challenge.channel !== request.sender.channel ||
                challenge.installationId !== request.sender.installationId
              )
                return yield* fail("invalid_challenge");
              if (challenge.confirmedSenderId) {
                if (challenge.confirmedSenderId !== request.sender.senderId)
                  return yield* fail("invalid_challenge");
                return { challengeId: challenge.id };
              }
              const prompts = yield* sql<{ senderId: string }>`
                SELECT sender_id AS "senderId" FROM public.channel_auth_prompt
                WHERE challenge_id = ${challenge.id}`;
              if (prompts[0] && prompts[0].senderId !== request.sender.senderId)
                return yield* fail("invalid_challenge");
              if (challenge.purpose === "link") {
                if (!challenge.targetUserId || !challenge.requestingSessionId)
                  return yield* fail("invalid_challenge");
                yield* requireSession(
                  challenge.targetUserId,
                  challenge.requestingSessionId
                );
              }
              const existing = yield* findIdentity(request.sender);
              if (existing?.revoked) return yield* fail("identity_inactive");
              if (
                existing &&
                challenge.targetUserId &&
                existing.userId !== challenge.targetUserId
              )
                return yield* fail("account_conflict");
              if (challenge.purpose === "login" && !existing)
                return yield* fail("sender_unlinked");
              yield* sql`UPDATE public.channel_auth_challenge
                SET confirmed_sender_id = ${request.sender.senderId}, confirmed_at = clock_timestamp()
                WHERE id = ${challenge.id}`;
              return { challengeId: challenge.id };
            })
          );
        }
      );
      const getChallengeStatus = Effect.fn(
        "ChannelAccounts.getChallengeStatus"
      )(function* (input: typeof ChallengeStatus.Type) {
        const request = yield* decode(ChallengeStatus, input);
        const rows = yield* sql<typeof channelChallengeStatusSchema.Type>`
            SELECT CASE
              WHEN consumed_at IS NOT NULL THEN 'consumed'
              WHEN cancelled_at IS NOT NULL OR expires_at <= clock_timestamp() THEN 'expired'
              WHEN confirmed_at IS NOT NULL THEN 'confirmed'
              ELSE 'pending'
            END AS status
            FROM public.channel_auth_challenge
            WHERE id = ${request.challengeId} AND browser_secret_hash = ${hash(request.browserSecret)}`;
        const result = rows[0];
        if (!result) return yield* fail("invalid_challenge");
        return result;
      });
      const consumeChallenge = Effect.fn("ChannelAccounts.consumeChallenge")(
        function* (input: typeof ConsumeChallenge.Type) {
          const request = yield* decode(ConsumeChallenge, input);
          return yield* transaction(
            Effect.gen(function* () {
              const rows = yield* sql<
                typeof ChallengeRow.Type
              >`SELECT id, purpose, channel, installation_id AS "installationId",
          target_user_id AS "targetUserId", source_user_id AS "sourceUserId", requesting_session_id AS "requestingSessionId", identity_id AS "identityId", confirmed_sender_id AS "confirmedSenderId"
          FROM public.channel_auth_challenge WHERE id = ${request.challengeId}
          AND browser_secret_hash = ${hash(request.browserSecret)} AND confirmed_at IS NOT NULL
          AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`;
              const challenge = rows[0];
              if (!challenge?.confirmedSenderId)
                return yield* fail("invalid_challenge");
              const sender = {
                channel: challenge.channel,
                installationId: challenge.installationId,
                senderId: challenge.confirmedSenderId,
              };
              const identity = yield* Effect.gen(function* () {
                switch (challenge.purpose) {
                  case "link": {
                    if (
                      !challenge.targetUserId ||
                      !challenge.requestingSessionId ||
                      challenge.requestingSessionId !== request.currentSessionId
                    )
                      return yield* fail("session_invalid");
                    yield* requireSession(
                      challenge.targetUserId,
                      challenge.requestingSessionId,
                      true
                    );
                    if (challenge.sourceUserId)
                      yield* archiveChannelAccount({
                        sourceUserId: challenge.sourceUserId,
                        targetUserId: challenge.targetUserId,
                        challengeId: challenge.id,
                        sender,
                      }).pipe(Effect.provideService(PgClient.PgClient, sql));
                    return yield* linkIdentity(sender, challenge.targetUserId);
                  }
                  case "login":
                    return yield* requireLinkedIdentity(sender);
                  default: {
                    const purpose: never = challenge.purpose;
                    return purpose;
                  }
                }
              });
              yield* sql`UPDATE public.channel_auth_challenge SET identity_id = CASE WHEN source_user_id IS NULL THEN ${identity.id} ELSE intended_identity_id END,
                consumed_at = clock_timestamp() WHERE id = ${challenge.id}`;
              const principalId = `better-auth:${identity.userId}`;
              const scope = accessScopeForUser(principalId);
              return {
                userId: identity.userId,
                identityId: identity.id,
                purpose: challenge.purpose,
                principalId,
                workspaceId: scope.workspaceId,
              };
            })
          );
        }
      );
      // Internal post-consumption issuance: the user is already committed and visible
      // to the SDK's separate connection. Do not retry a failed or uncertain issuance.
      const withLoginSession = Effect.fn("ChannelAccounts.withLoginSession")(
        function* <A, E, R>(
          owner: typeof SessionOwner.Type,
          createSession: Effect.Effect<A, E, R>
        ) {
          const request = yield* decode(SessionOwner, owner);
          return yield* transaction(
            Effect.gen(function* () {
              const rows = yield* sql`SELECT id FROM public.channel_identity
              WHERE id = ${request.identityId} AND user_id = ${request.userId} AND revoked_at IS NULL`;
              if (!rows.length) return yield* fail("identity_inactive");
              return yield* createSession;
            })
          ).pipe(
            // SDK Promises cannot be cancelled reliably: retain the lock until the
            // insertion settles and the finalization commits, even on interruption.
            Effect.uninterruptible
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
          AND (identity_id = ${request.identityId} OR intended_identity_id = ${request.identityId} OR target_user_id = ${request.userId}
            OR requesting_session_id IN (SELECT id FROM public.session WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM public.channel_identity i WHERE i.id = ${request.identityId}
              AND i.channel = public.channel_auth_challenge.channel
              AND i.installation_id = public.channel_auth_challenge.installation_id
              AND i.sender_id = public.channel_auth_challenge.confirmed_sender_id))`;
              yield* sql`DELETE FROM public.session WHERE "userId" = ${request.userId}`;
              return undefined;
            })
          );
        }
      );
      return ChannelAccounts.of({
        requireFreshSession,
        resolveVerifiedSender,
        recordUnlinkedContact,
        getActiveIdentity,
        issueChallenge,
        confirmChallenge,
        previewChallenge,
        consumeChallenge,
        withLoginSession,
        getChallengeStatus,
        revokeIdentity,
      });
    })
  );
}

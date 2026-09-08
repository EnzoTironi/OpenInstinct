import { createHash, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  ChannelAccountError,
  ChannelAccounts,
  PreviewChallenge,
  VerifiedSender,
} from "../accounts/index.ts";

const Id = Schema.String.check(Schema.isUUID(4));
const Identifier = Schema.NonEmptyString.check(Schema.isTrimmed());
const Status = Schema.Literals([
  "queued",
  "dispatching",
  "sent",
  "uncertain",
  "failed",
  "cancelled",
]);
const PreparePrompt = Schema.Struct({
  ...PreviewChallenge.fields,
  eventId: Identifier,
});
const PromptLease = Schema.Struct({ challengeId: Id, leaseToken: Id });
const PromptReceipt = Schema.Struct({ challengeId: Id, status: Status });
const Envelope = Schema.Struct({ challengeId: Id, ...PreparePrompt.fields });
const EnvelopeJson = Schema.fromJsonString(Envelope);
const PromptRow = Schema.Struct({
  ...PromptReceipt.fields,
  ...VerifiedSender.fields,
  eventId: Identifier,
  tokenCiphertext: Schema.NullOr(Schema.String),
});
export class ChannelAuthPromptError extends Schema.TaggedError<ChannelAuthPromptError>()(
  "ChannelAuthPromptError",
  {
    reason: Schema.Literals([
      "invalid_input",
      "conflict",
      "lease_lost",
      "crypto_unavailable",
    ]),
  }
) {}
type Failure = ChannelAuthPromptError | ChannelAccountError | SqlError;
type ClaimedPrompt = typeof VerifiedSender.Type & {
  readonly lease: typeof PromptLease.Type;
  readonly token: string;
};
interface Prompts {
  readonly prepare: (
    input: typeof PreparePrompt.Type
  ) => Effect.Effect<typeof PromptReceipt.Type, Failure>;
  readonly pending: (
    limit?: number
  ) => Effect.Effect<readonly string[], Failure>;
  readonly claim: (
    challengeId: string
  ) => Effect.Effect<ClaimedPrompt | null, Failure>;
  readonly checkLease: (
    lease: typeof PromptLease.Type
  ) => Effect.Effect<void, Failure>;
  readonly markSent: (
    lease: typeof PromptLease.Type,
    providerMessageId: string
  ) => Effect.Effect<void, Failure>;
  readonly markUncertain: (
    lease: typeof PromptLease.Type
  ) => Effect.Effect<void, Failure>;
  readonly markRejected: (
    lease: typeof PromptLease.Type
  ) => Effect.Effect<void, Failure>;
}
const error = (reason: ChannelAuthPromptError["reason"]) =>
  new ChannelAuthPromptError({ reason });
const decode = <S extends Schema.Constraint>(schema: S, input: S["Type"]) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => error("invalid_input"))
  );
const encryptionKey = Config.redacted("BETTER_AUTH_SECRET").pipe(
  Effect.flatMap((key) =>
    Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(32)))(
      Redacted.value(key)
    ).pipe(Effect.as(key))
  ),
  Effect.mapError(() => error("crypto_unavailable"))
);

/** A single encrypted confirmation prompt per challenge. No provider I/O or polling. */
export class ChannelAuthPrompts extends Context.Service<
  ChannelAuthPrompts,
  Prompts
>()("companion/ChannelAuthPrompts") {
  static readonly layer = Layer.effect(
    ChannelAuthPrompts,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const accounts = yield* ChannelAccounts;
      const transaction = <A, E>(operation: Effect.Effect<A, E>) =>
        sql.withTransaction(
          Effect.gen(function* () {
            // Shared with account mutations, so proof validation and queue transitions agree.
            yield* sql`SELECT pg_advisory_xact_lock(724193, 1)`;
            return yield* operation;
          })
        );
      const retire = Effect.gen(function* () {
        yield* sql`UPDATE public.channel_auth_prompt SET status = 'uncertain', token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = 'lease_expired'
        WHERE status = 'dispatching' AND lease_expires_at <= clock_timestamp()`;
        yield* sql`UPDATE public.channel_auth_prompt p SET status = 'cancelled', token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = 'challenge_inactive'
        FROM public.channel_auth_challenge c WHERE c.id = p.challenge_id
        AND p.status = 'queued'
        AND (c.expires_at <= clock_timestamp() OR c.cancelled_at IS NOT NULL OR c.confirmed_at IS NOT NULL OR c.consumed_at IS NOT NULL)`;
      });
      const select = Effect.fn("ChannelAuthPrompts.select")(function* (
        challengeId: string
      ) {
        const rows = yield* sql<
          typeof PromptRow.Type
        >`SELECT challenge_id AS "challengeId", channel,
        installation_id AS "installationId", sender_id AS "senderId", event_id AS "eventId",
        token_ciphertext AS "tokenCiphertext", status FROM public.channel_auth_prompt WHERE challenge_id = ${challengeId}`;
        return rows[0];
      });
      const cancel = Effect.fn("ChannelAuthPrompts.cancel")(function* (
        challengeId: string,
        status: "cancelled" | "failed"
      ) {
        yield* sql`UPDATE public.channel_auth_prompt SET status = ${status}, token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = ${status === "failed" ? "invalid_envelope" : "challenge_inactive"}
        WHERE challenge_id = ${challengeId} AND status = 'queued'`;
      });
      const preview = Effect.fn("ChannelAuthPrompts.preview")(
        (input: typeof PreviewChallenge.Type) =>
          accounts
            .previewChallenge(input)
            .pipe(
              Effect.catchTag("ChannelAccountError", () => Effect.succeed(null))
            )
      );
      const decrypt = Effect.fn("ChannelAuthPrompts.decrypt")(function* (
        row: typeof PromptRow.Type
      ) {
        const ciphertext = row.tokenCiphertext;
        if (!ciphertext) return null;
        const key = yield* encryptionKey;
        const plaintext = yield* Effect.tryPromise({
          try: () =>
            symmetricDecrypt({
              key: Redacted.value(key),
              data: ciphertext,
            }),
          catch: () => "corrupt" as const,
        }).pipe(Effect.catch(() => Effect.succeed(null)));
        if (plaintext === null) return null;
        const envelope = yield* Schema.decodeUnknownEffect(EnvelopeJson)(
          plaintext
        ).pipe(Effect.catch(() => Effect.succeed(null)));
        if (
          !envelope ||
          envelope.challengeId !== row.challengeId ||
          envelope.eventId !== row.eventId ||
          envelope.sender.channel !== row.channel ||
          envelope.sender.installationId !== row.installationId ||
          envelope.sender.senderId !== row.senderId
        )
          return null;
        return envelope;
      });
      const prepare = Effect.fn("ChannelAuthPrompts.prepare")(function* (
        input: typeof PreparePrompt.Type
      ) {
        const request = yield* decode(PreparePrompt, input);
        return yield* transaction(
          Effect.gen(function* () {
            yield* retire;
            const challenges = yield* sql<{
              id: string;
            }>`SELECT id FROM public.channel_auth_challenge
          WHERE token_hash = ${createHash("sha256").update(request.token).digest("hex")}
          AND channel = ${request.sender.channel} AND installation_id = ${request.sender.installationId}`;
            const challenge = challenges[0];
            if (!challenge)
              return yield* new ChannelAccountError({
                reason: "invalid_challenge",
              });
            const events = yield* sql<{
              challengeId: string;
            }>`SELECT challenge_id AS "challengeId" FROM public.channel_auth_prompt
          WHERE channel = ${request.sender.channel} AND installation_id = ${request.sender.installationId} AND event_id = ${request.eventId}`;
            if (events.some((event) => event.challengeId !== challenge.id))
              return yield* error("conflict");
            const existing = yield* select(challenge.id);
            if (existing) {
              if (
                existing.senderId !== request.sender.senderId ||
                existing.channel !== request.sender.channel ||
                existing.installationId !== request.sender.installationId
              )
                return yield* error("conflict");
              if (existing.status === "queued") {
                const valid = yield* preview(request);
                if (!valid) {
                  yield* cancel(challenge.id, "cancelled");
                  return {
                    challengeId: challenge.id,
                    status: "cancelled" as const,
                  };
                }
              }
              return { challengeId: challenge.id, status: existing.status };
            }
            yield* accounts.previewChallenge(request);
            const key = yield* encryptionKey;
            const encoded = yield* Schema.encodeEffect(EnvelopeJson)({
              ...request,
              challengeId: challenge.id,
            }).pipe(Effect.mapError(() => error("invalid_input")));
            const ciphertext = yield* Effect.tryPromise({
              try: () =>
                symmetricEncrypt({ key: Redacted.value(key), data: encoded }),
              catch: () => error("crypto_unavailable"),
            });
            yield* sql`INSERT INTO public.channel_auth_prompt
          (challenge_id, channel, installation_id, sender_id, event_id, token_ciphertext)
          VALUES (${challenge.id}, ${request.sender.channel}, ${request.sender.installationId}, ${request.sender.senderId}, ${request.eventId}, ${ciphertext})`;
            return { challengeId: challenge.id, status: "queued" as const };
          })
        );
      });
      const pending = Effect.fn("ChannelAuthPrompts.pending")(function* (
        limit?: number
      ) {
        const size = yield* decode(
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
          limit ?? 100
        );
        return yield* transaction(
          Effect.gen(function* () {
            yield* retire;
            const rows = yield* sql<{
              challengeId: string;
            }>`SELECT challenge_id AS "challengeId" FROM public.channel_auth_prompt
          WHERE status = 'queued' ORDER BY created_at, challenge_id LIMIT ${size}`;
            return rows.map((row) => row.challengeId);
          })
        );
      });
      const claim = Effect.fn("ChannelAuthPrompts.claim")(function* (
        challengeId: string
      ) {
        const id = yield* decode(Id, challengeId);
        return yield* transaction(
          Effect.gen(function* () {
            yield* retire;
            const row = yield* select(id);
            if (row?.status !== "queued") return null;
            const envelope = yield* decrypt(row);
            if (!envelope) {
              yield* cancel(id, "failed");
              return null;
            }
            if (!(yield* preview(envelope))) {
              yield* cancel(id, "cancelled");
              return null;
            }
            const leaseToken = randomUUID();
            yield* sql`UPDATE public.channel_auth_prompt SET status = 'dispatching', attempts = attempts + 1,
          lease_token = ${leaseToken}, lease_expires_at = clock_timestamp() + interval '30 seconds'
          WHERE challenge_id = ${id} AND status = 'queued'`;
            return {
              lease: { challengeId: id, leaseToken },
              ...envelope.sender,
              token: envelope.token,
            };
          })
        );
      });
      const checkLease = Effect.fn("ChannelAuthPrompts.checkLease")(function* (
        input: typeof PromptLease.Type
      ) {
        const lease = yield* decode(PromptLease, input);
        const valid = yield* transaction(
          Effect.gen(function* () {
            yield* retire;
            const matches =
              yield* sql`SELECT challenge_id FROM public.channel_auth_prompt
          WHERE challenge_id = ${lease.challengeId} AND lease_token = ${lease.leaseToken}
          AND status = 'dispatching' AND lease_expires_at > clock_timestamp()`;
            if (!matches.length) return false;
            const row = yield* select(lease.challengeId);
            if (!row) return false;
            const envelope = yield* decrypt(row);
            // A failed recheck prevents new I/O, but must not erase a receipt
            // from I/O that already began under this lease.
            if (!envelope || !(yield* preview(envelope))) return false;
            yield* retire;
            const active = yield* sql<{ valid: boolean }>`SELECT EXISTS (
              SELECT 1 FROM public.channel_auth_prompt p JOIN public.channel_auth_challenge c ON c.id = p.challenge_id
              WHERE p.challenge_id = ${lease.challengeId} AND p.lease_token = ${lease.leaseToken}
              AND p.status = 'dispatching' AND p.lease_expires_at > clock_timestamp()
              AND c.expires_at > clock_timestamp() AND c.confirmed_at IS NULL
              AND c.cancelled_at IS NULL AND c.consumed_at IS NULL) AS valid`;
            return active[0]?.valid === true;
          })
        );
        if (!valid) return yield* error("lease_lost");
        return undefined;
      });
      const settle = Effect.fn("ChannelAuthPrompts.settle")(function* (
        input: typeof PromptLease.Type,
        status: "sent" | "uncertain" | "failed",
        providerMessageId: string | null
      ) {
        const lease = yield* decode(PromptLease, input);
        const changed = yield* transaction(
          Effect.gen(function* () {
            yield* retire;
            return yield* sql`UPDATE public.channel_auth_prompt SET status = ${status}, token_ciphertext = NULL,
          lease_token = NULL, lease_expires_at = NULL, provider_message_id = ${providerMessageId},
          sent_at = CASE WHEN ${status} = 'sent' THEN clock_timestamp() ELSE NULL END,
          last_error = CASE WHEN ${status} = 'sent' THEN NULL ELSE ${status === "failed" ? "delivery_rejected" : "delivery_uncertain"} END
          WHERE challenge_id = ${lease.challengeId} AND lease_token = ${lease.leaseToken}
          AND status = 'dispatching' AND lease_expires_at > clock_timestamp() RETURNING challenge_id`;
          })
        );
        if (!changed.length) return yield* error("lease_lost");
        return undefined;
      });
      const markSent = Effect.fn("ChannelAuthPrompts.markSent")(function* (
        lease: typeof PromptLease.Type,
        providerMessageId: string
      ) {
        const id = yield* decode(Identifier, providerMessageId);
        yield* settle(lease, "sent", id);
      });
      return ChannelAuthPrompts.of({
        prepare,
        pending,
        claim,
        checkLease,
        markSent,
        markUncertain: (lease) => settle(lease, "uncertain", null),
        markRejected: (lease) => settle(lease, "failed", null),
      });
    })
  );
}

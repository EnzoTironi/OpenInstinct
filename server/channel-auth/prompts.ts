import { createHash, randomUUID } from "node:crypto";

import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Option, Context, Effect, Layer, Redacted, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import {
  ChannelAccountError,
  ChannelAccounts,
  PreviewChallenge,
  VerifiedSender,
} from "../accounts/index.ts";

const decodeSchema_String_check_Schema_isMinLength_32 =
  Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(32)));

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

const decodeEffect_EnvelopeJson = Schema.decodeUnknownEffect(EnvelopeJson);

const encodeEffect_EnvelopeJson = Schema.encodeEffect(EnvelopeJson);

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

/* oxlint-disable anti-slop/no-unknown-parameters, typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- WeakMap-cached generic Schema.decodeUnknownEffect; required by agent-doctor hoist-schema-codecs. */
const decodeUnknownEffectCache = new WeakMap<
  object,
  (input: unknown) => Effect.Effect<unknown, unknown>
>();

const decode = <S extends Schema.Constraint>(schema: S, input: S["Type"]) => {
  let decoder = decodeUnknownEffectCache.get(schema) as
    | ((input: S["Type"]) => Effect.Effect<S["Type"], unknown>)
    | undefined;

  if (!decoder) {
    const built = Schema.decodeUnknownEffect(schema);
    decodeUnknownEffectCache.set(schema, built as never);
    decoder = built as (input: S["Type"]) => Effect.Effect<S["Type"], unknown>;
  }

  return decoder(input).pipe(Effect.mapError(() => error("invalid_input")));
};
/* oxlint-enable anti-slop/no-unknown-parameters, typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */

/** A single encrypted confirmation prompt per challenge. No provider I/O or polling. */
type Sql = PgClient.PgClient;

type ServiceOf<S> =
  S extends Context.Service<infer _I, infer Api> ? Api : never;

type AccountsService = ServiceOf<typeof ChannelAccounts>;

type InstallationService = ServiceOf<typeof ResolvedInstallationSecrets>;

type SelectPrompt = (
  challengeId: string
) => Effect.Effect<typeof PromptRow.Type | undefined, SqlError>;

type CancelPrompt = (
  challengeId: string,
  status: "cancelled" | "failed"
) => Effect.Effect<void, Failure>;

type PreviewPrompt = (
  input: typeof PreviewChallenge.Type
) => Effect.Effect<unknown, Failure>;

type DecryptPrompt = (
  row: typeof PromptRow.Type
) => Effect.Effect<typeof Envelope.Type | null, Failure>;

type EncryptionKey = Effect.Effect<
  InstallationService["betterAuthSecret"],
  ChannelAuthPromptError
>;

const makeEncryptionKey = (installation: InstallationService): EncryptionKey =>
  Effect.gen(function* () {
    const key = installation.betterAuthSecret;
    yield* decodeSchema_String_check_Schema_isMinLength_32(Redacted.value(key));

    return key;
  }).pipe(Effect.mapError(() => error("crypto_unavailable")));

const withPromptTransaction =
  (sql: Sql) =>
  <A, E>(operation: Effect.Effect<A, E>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        // Shared with account mutations, so proof validation and queue transitions agree.
        yield* sql`SELECT pg_advisory_xact_lock(724193, 1)`;

        return yield* operation;
      })
    );

const makeRetire = Effect.fn("makeRetire")(function* (sql: Sql) {
  yield* sql`UPDATE public.channel_auth_prompt SET status = 'uncertain', token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = 'lease_expired'
        WHERE status = 'dispatching' AND lease_expires_at <= clock_timestamp()`;
  yield* sql`UPDATE public.channel_auth_prompt p SET status = 'cancelled', token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = 'challenge_inactive'
        FROM public.channel_auth_challenge c WHERE c.id = p.challenge_id
        AND p.status = 'queued'
        AND (c.expires_at <= clock_timestamp() OR c.cancelled_at IS NOT NULL OR c.confirmed_at IS NOT NULL OR c.consumed_at IS NOT NULL)`;
});

const makeSelect = (sql: Sql): SelectPrompt =>
  Effect.fn("ChannelAuthPrompts.select")(function* (challengeId: string) {
    const rows = yield* sql<
      typeof PromptRow.Type
    >`SELECT challenge_id AS "challengeId", channel,
        installation_id AS "installationId", sender_id AS "senderId", event_id AS "eventId",
        token_ciphertext AS "tokenCiphertext", status FROM public.channel_auth_prompt WHERE challenge_id = ${challengeId}`;

    return rows[0];
  });

const makeCancel = (sql: Sql): CancelPrompt =>
  Effect.fn("ChannelAuthPrompts.cancel")(function* (
    challengeId: string,
    status: "cancelled" | "failed"
  ) {
    const lastError =
      status === "failed" ? "invalid_envelope" : "challenge_inactive";

    yield* sql`UPDATE public.channel_auth_prompt SET status = ${status}, token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = ${lastError}
        WHERE challenge_id = ${challengeId} AND status = 'queued'`;
  });

const makePreview = (accounts: AccountsService): PreviewPrompt =>
  Effect.fn("ChannelAuthPrompts.preview")(
    (input: typeof PreviewChallenge.Type) =>
      accounts
        .previewChallenge(input)
        .pipe(
          Effect.catchTag("ChannelAccountError", () => Effect.succeed(null))
        )
  );

const envelopeMatchesRow = (
  envelope: typeof Envelope.Type,
  row: typeof PromptRow.Type
) =>
  envelope.challengeId === row.challengeId &&
  envelope.eventId === row.eventId &&
  envelope.sender.channel === row.channel &&
  envelope.sender.installationId === row.installationId &&
  envelope.sender.senderId === row.senderId;

const makeDecrypt = (encryptionKey: EncryptionKey): DecryptPrompt =>
  Effect.fn("ChannelAuthPrompts.decrypt")(function* (
    row: typeof PromptRow.Type
  ) {
    const ciphertext = row.tokenCiphertext;

    if (!ciphertext) return null;
    const key = yield* encryptionKey;

    const plaintextOption = yield* Effect.tryPromise({
      try: () =>
        symmetricDecrypt({
          key: Redacted.value(key),
          data: ciphertext,
        }),
      catch: () => "corrupt" as const,
    }).pipe(Effect.option);

    if (Option.isNone(plaintextOption)) return null;
    const plaintext = plaintextOption.value;

    const envelopeOption = yield* decodeEffect_EnvelopeJson(plaintext).pipe(
      Effect.option
    );

    const envelope = Option.getOrNull(envelopeOption);

    if (!envelope) return null;

    if (!envelopeMatchesRow(envelope, row)) return null;

    return envelope;
  });

const senderConflicts = (
  existing: typeof PromptRow.Type,
  request: typeof PreparePrompt.Type
) =>
  existing.senderId !== request.sender.senderId ||
  existing.channel !== request.sender.channel ||
  existing.installationId !== request.sender.installationId;

const resolveQueuedExisting = Effect.fn("resolveQueuedExisting")(function* (
  challengeId: string,
  request: typeof PreparePrompt.Type,
  preview: PreviewPrompt,
  cancel: CancelPrompt
) {
  const valid = yield* preview(request);

  if (!valid) {
    yield* cancel(challengeId, "cancelled");

    return {
      challengeId,
      status: "cancelled" as const,
    };
  }

  return { challengeId, status: "queued" as const };
});

const prepareExisting = Effect.fn("prepareExisting")(function* (input: {
  readonly existing: typeof PromptRow.Type;
  readonly challengeId: string;
  readonly request: typeof PreparePrompt.Type;
  readonly preview: PreviewPrompt;
  readonly cancel: CancelPrompt;
}) {
  const { existing, challengeId, request, preview, cancel } = input;

  if (senderConflicts(existing, request)) return yield* error("conflict");

  if (existing.status === "queued") {
    return yield* resolveQueuedExisting(challengeId, request, preview, cancel);
  }

  return { challengeId, status: existing.status };
});

const insertPreparedPrompt = Effect.fn("insertPreparedPrompt")(
  function* (input: {
    readonly sql: Sql;
    readonly challengeId: string;
    readonly request: typeof PreparePrompt.Type;
    readonly accounts: AccountsService;
    readonly encryptionKey: EncryptionKey;
  }) {
    const { sql, challengeId, request, accounts, encryptionKey } = input;

    yield* accounts.previewChallenge(request);
    const key = yield* encryptionKey;

    const encoded = yield* encodeEffect_EnvelopeJson({
      ...request,
      challengeId,
    }).pipe(Effect.mapError(() => error("invalid_input")));

    const ciphertext = yield* Effect.tryPromise({
      try: () => symmetricEncrypt({ key: Redacted.value(key), data: encoded }),
      catch: () => error("crypto_unavailable"),
    });

    yield* sql`INSERT INTO public.channel_auth_prompt
        (challenge_id, channel, installation_id, sender_id, event_id, token_ciphertext)
        VALUES (${challengeId}, ${request.sender.channel}, ${request.sender.installationId}, ${request.sender.senderId}, ${request.eventId}, ${ciphertext})`;

    return { challengeId, status: "queued" as const };
  }
);

const prepareTransactionBody = Effect.fn("prepareTransactionBody")(function* (
  sql: Sql,
  request: typeof PreparePrompt.Type,
  deps: {
    readonly retire: Effect.Effect<void, SqlError>;
    readonly select: SelectPrompt;
    readonly cancel: CancelPrompt;
    readonly preview: PreviewPrompt;
    readonly accounts: AccountsService;
    readonly encryptionKey: EncryptionKey;
  }
) {
  yield* deps.retire;

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
  const existing = yield* deps.select(challenge.id);

  if (existing) {
    return yield* prepareExisting({
      existing,
      challengeId: challenge.id,
      request,
      preview: deps.preview,
      cancel: deps.cancel,
    });
  }

  return yield* insertPreparedPrompt({
    sql,
    challengeId: challenge.id,
    request,
    accounts: deps.accounts,
    encryptionKey: deps.encryptionKey,
  });
});

const makePrepare = (
  sql: Sql,
  transaction: ReturnType<typeof withPromptTransaction>,
  deps: {
    readonly retire: Effect.Effect<void, SqlError>;
    readonly select: SelectPrompt;
    readonly cancel: CancelPrompt;
    readonly preview: PreviewPrompt;
    readonly accounts: AccountsService;
    readonly encryptionKey: EncryptionKey;
  }
) =>
  Effect.fn("ChannelAuthPrompts.prepare")(function* (
    input: typeof PreparePrompt.Type
  ) {
    const request = yield* decode(PreparePrompt, input);

    return yield* transaction(prepareTransactionBody(sql, request, deps));
  });

const makePending = (
  transaction: ReturnType<typeof withPromptTransaction>,
  sql: Sql,
  retire: Effect.Effect<void, SqlError>
) =>
  Effect.fn("ChannelAuthPrompts.pending")(function* (limit?: number) {
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

const claimQueuedPrompt = Effect.fn("claimQueuedPrompt")(function* (input: {
  readonly sql: Sql;
  readonly id: string;
  readonly row: typeof PromptRow.Type;
  readonly decrypt: DecryptPrompt;
  readonly preview: PreviewPrompt;
  readonly cancel: CancelPrompt;
}) {
  const { sql, id, row, decrypt, preview, cancel } = input;

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
});

const makeClaim = (
  transaction: ReturnType<typeof withPromptTransaction>,
  sql: Sql,
  deps: {
    readonly retire: Effect.Effect<void, SqlError>;
    readonly select: SelectPrompt;
    readonly decrypt: DecryptPrompt;
    readonly preview: PreviewPrompt;
    readonly cancel: CancelPrompt;
  }
) =>
  Effect.fn("ChannelAuthPrompts.claim")(function* (challengeId: string) {
    const id = yield* decode(Id, challengeId);

    return yield* transaction(
      Effect.gen(function* () {
        yield* deps.retire;
        const row = yield* deps.select(id);

        if (row?.status !== "queued") return null;

        return yield* claimQueuedPrompt({
          sql,
          id,
          row,
          decrypt: deps.decrypt,
          preview: deps.preview,
          cancel: deps.cancel,
        });
      })
    );
  });

const validateLeaseStillActive = Effect.fn("validateLeaseStillActive")(
  function* (input: {
    readonly sql: Sql;
    readonly lease: typeof PromptLease.Type;
    readonly select: SelectPrompt;
    readonly decrypt: DecryptPrompt;
    readonly preview: PreviewPrompt;
    readonly retire: Effect.Effect<void, SqlError>;
  }) {
    const { sql, lease, select, decrypt, preview, retire } = input;

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
    if (!envelope) return false;

    if (!(yield* preview(envelope))) return false;
    yield* retire;

    const active = yield* sql<{ valid: boolean }>`SELECT EXISTS (
            SELECT 1 FROM public.channel_auth_prompt p JOIN public.channel_auth_challenge c ON c.id = p.challenge_id
            WHERE p.challenge_id = ${lease.challengeId} AND p.lease_token = ${lease.leaseToken}
            AND p.status = 'dispatching' AND p.lease_expires_at > clock_timestamp()
            AND c.expires_at > clock_timestamp() AND c.confirmed_at IS NULL
            AND c.cancelled_at IS NULL AND c.consumed_at IS NULL) AS valid`;

    return active[0]?.valid === true;
  }
);

const makeCheckLease = (
  transaction: ReturnType<typeof withPromptTransaction>,
  sql: Sql,
  deps: {
    readonly retire: Effect.Effect<void, SqlError>;
    readonly select: SelectPrompt;
    readonly decrypt: DecryptPrompt;
    readonly preview: PreviewPrompt;
  }
) =>
  Effect.fn("ChannelAuthPrompts.checkLease")(function* (
    input: typeof PromptLease.Type
  ) {
    const lease = yield* decode(PromptLease, input);

    const valid = yield* transaction(
      validateLeaseStillActive({
        sql,
        lease,
        select: deps.select,
        decrypt: deps.decrypt,
        preview: deps.preview,
        retire: deps.retire,
      })
    );

    if (!valid) return yield* error("lease_lost");

    return undefined;
  });

const settleLastError = (status: "sent" | "uncertain" | "failed") => {
  if (status === "sent") return null;

  if (status === "failed") return "delivery_rejected";

  return "delivery_uncertain";
};

const makeSettle = (
  transaction: ReturnType<typeof withPromptTransaction>,
  sql: Sql,
  retire: Effect.Effect<void, SqlError>
) =>
  Effect.fn("ChannelAuthPrompts.settle")(function* (
    input: typeof PromptLease.Type,
    status: "sent" | "uncertain" | "failed",
    providerMessageId: string | null
  ) {
    const lease = yield* decode(PromptLease, input);
    const lastError = settleLastError(status);

    const changed = yield* transaction(
      Effect.gen(function* () {
        yield* retire;

        return yield* sql`UPDATE public.channel_auth_prompt SET status = ${status}, token_ciphertext = NULL,
          lease_token = NULL, lease_expires_at = NULL, provider_message_id = ${providerMessageId},
          sent_at = CASE WHEN ${status} = 'sent' THEN clock_timestamp() ELSE NULL END,
          last_error = CASE WHEN ${status} = 'sent' THEN NULL ELSE ${lastError} END
          WHERE challenge_id = ${lease.challengeId} AND lease_token = ${lease.leaseToken}
          AND status = 'dispatching' AND lease_expires_at > clock_timestamp() RETURNING challenge_id`;
      })
    );

    if (!changed.length) return yield* error("lease_lost");

    return undefined;
  });

const makeMarkSent = (settle: ReturnType<typeof makeSettle>) =>
  Effect.fn("ChannelAuthPrompts.markSent")(function* (
    lease: typeof PromptLease.Type,
    providerMessageId: string
  ) {
    const id = yield* decode(Identifier, providerMessageId);
    yield* settle(lease, "sent", id);
  });

const makePrompts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const accounts = yield* ChannelAccounts;
  const installation = yield* ResolvedInstallationSecrets;

  const encryptionKey = makeEncryptionKey(installation);
  const transaction = withPromptTransaction(sql);
  const retire = makeRetire(sql);
  const select = makeSelect(sql);
  const cancel = makeCancel(sql);
  const preview = makePreview(accounts);
  const decrypt = makeDecrypt(encryptionKey);
  const settle = makeSettle(transaction, sql, retire);

  const shared = {
    accounts,
    cancel,
    encryptionKey,
    preview,
    retire,
    select,
  } as const;

  return {
    prepare: makePrepare(sql, transaction, shared),
    pending: makePending(transaction, sql, retire),
    claim: makeClaim(transaction, sql, {
      cancel,
      decrypt,
      preview,
      retire,
      select,
    }),
    checkLease: makeCheckLease(transaction, sql, {
      decrypt,
      preview,
      retire,
      select,
    }),
    markSent: makeMarkSent(settle),
    markUncertain: (lease: typeof PromptLease.Type) =>
      settle(lease, "uncertain", null),
    markRejected: (lease: typeof PromptLease.Type) =>
      settle(lease, "failed", null),
  } satisfies Prompts;
});

export class ChannelAuthPrompts extends Context.Service<
  ChannelAuthPrompts,
  Prompts
>()("companion/ChannelAuthPrompts") {
  static readonly layer = Layer.effect(ChannelAuthPrompts, makePrompts);
}

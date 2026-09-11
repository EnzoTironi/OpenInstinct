import { createHash, createHmac, randomUUID } from "node:crypto";

import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { accessScopeForUser } from "../../shared/identity/access-scope";
import {
  deviceBindingSchema,
  channelChallengeRequestSchema,
} from "../../shared/identity/channel-auth";
import { ChannelAccountError, ChannelAccounts } from "./index";

const Identifier = Schema.NonEmptyString.check(Schema.isTrimmed());

const Id = Schema.String.check(Schema.isUUID());

const Secret = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u));

const Source = Schema.Struct({ identityId: Id, sessionId: Identifier });

const Purpose = channelChallengeRequestSchema.fields.purpose;

const BrowserSession = Schema.Struct({
  userId: Identifier,
  sessionId: Identifier,
});

const Issue = Schema.Struct({
  ...Source.fields,
  callId: Identifier,
  purpose: Purpose,
});

const Resume = Schema.Struct({
  id: Id,
  purpose: Purpose,
  browserSecret: Secret,
  link: Schema.optionalKey(BrowserSession),
});

const Bind = Schema.Struct({
  ...deviceBindingSchema.fields,
  browserSecret: Secret,
  link: Schema.optionalKey(BrowserSession),
});

const Selection = Schema.Struct({
  ...Source.fields,
  challengeId: Id,
  purpose: Purpose,
  browserBoundAt: Identifier,
});

const Device = Schema.Struct({
  id: Id,
  purpose: Purpose,
  channel: Schema.Literals(["telegram", "kapso"]),
  expiresAt: Schema.String,
  browserBoundAt: Schema.NullOr(Schema.String),
  confirmedAt: Schema.NullOr(Schema.String),
});

type Failure = ChannelAccountError | SqlError;

const invalid = () => new ChannelAccountError({ reason: "invalid_challenge" });

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

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
    const built = Schema.decodeUnknownEffect(schema, {
      onExcessProperty: "error",
    });

    decodeUnknownEffectCache.set(schema, built as never);
    decoder = built as (input: S["Type"]) => Effect.Effect<S["Type"], unknown>;
  }

  return decoder(input).pipe(Effect.mapError(() => invalid()));
};
/* oxlint-enable anti-slop/no-unknown-parameters, typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */

/** Native initiation and browser binding on the existing account challenge. */

interface DeviceAccounts {
  readonly getActiveIdentity: (sender: {
    readonly channel: "telegram" | "kapso";
    readonly installationId: string;
    readonly senderId: string;
  }) => Effect.Effect<
    {
      readonly id: string;
      readonly userId: string;
      readonly channel: "telegram" | "kapso";
      readonly installationId: string;
      readonly senderId: string;
    },
    Failure
  >;
  readonly requireFreshSession: (
    input: typeof BrowserSession.Type
  ) => Effect.Effect<unknown, Failure>;
}

interface DeviceInstallation {
  readonly betterAuthSecret: Redacted.Redacted;
}

interface DeviceCtx {
  readonly sql: PgClient.PgClient;
  readonly accounts: DeviceAccounts;
  readonly installation: DeviceInstallation;
  readonly transaction: <A, E>(
    operation: Effect.Effect<A, E>
  ) => Effect.Effect<A, E | SqlError>;
  readonly identity: (id: string) => Effect.Effect<
    {
      readonly id: string;
      readonly userId: string;
      readonly channel: "telegram" | "kapso";
      readonly installationId: string;
      readonly senderId: string;
    },
    Failure
  >;
  readonly sourceIdentity: (source: typeof Source.Type) => Effect.Effect<
    {
      readonly id: string;
      readonly userId: string;
      readonly channel: "telegram" | "kapso";
      readonly installationId: string;
      readonly senderId: string;
    },
    Failure
  >;
  readonly requireBoundSession: (
    id: string,
    userId: string,
    browser?: typeof BrowserSession.Type
  ) => Effect.Effect<unknown, Failure>;
  readonly select: (id: string) => Effect.Effect<typeof Device.Type, Failure>;
}

const makeTransaction = (sql: PgClient.PgClient) => {
  return <A, E>(operation: Effect.Effect<A, E>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        // Same account lifecycle lock as ChannelAccounts; no provider I/O under it.
        yield* sql`SELECT pg_advisory_xact_lock(724193, 1)`;

        return yield* operation;
      })
    );
};

const makeIdentity = (ctx: Pick<DeviceCtx, "sql" | "accounts">) =>
  Effect.fn("NativeDeviceAuth.identity")(function* (id: string) {
    const rows = yield* ctx.sql<{
      channel: "telegram" | "kapso";
      installationId: string;
      senderId: string;
    }>`SELECT channel, installation_id AS "installationId", sender_id AS "senderId"
        FROM public.channel_identity WHERE id = ${id} AND revoked_at IS NULL`;

    if (!rows[0]) return yield* invalid();

    return yield* ctx.accounts.getActiveIdentity(rows[0]);
  });

const makeSourceIdentity = (ctx: Pick<DeviceCtx, "sql" | "identity">) =>
  Effect.fn("NativeDeviceAuth.sourceIdentity")(function* (
    source: typeof Source.Type
  ) {
    const owner = yield* ctx.identity(source.identityId);
    const principalId = `better-auth:${owner.userId}`;

    const rows = yield* ctx.sql`SELECT s.session_id FROM agent_sessions s
        JOIN workspace_memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.created_by_user_id
        WHERE s.session_id = ${source.sessionId} AND s.created_by_user_id = ${principalId}
        AND s.workspace_id = ${accessScopeForUser(principalId).workspaceId}`;

    if (!rows.length) return yield* invalid();

    return owner;
  });

const makeRequireBoundSession = (ctx: Pick<DeviceCtx, "sql" | "accounts">) =>
  Effect.fn("NativeDeviceAuth.requireBoundSession")(function* (
    id: string,
    userId: string,
    browser?: typeof BrowserSession.Type
  ) {
    const rows = yield* ctx.sql<
      typeof BrowserSession.Type
    >`SELECT target_user_id AS "userId", requesting_session_id AS "sessionId"
          FROM public.channel_auth_challenge WHERE id = ${id} AND purpose = 'link'
          AND target_user_id = ${userId} AND requesting_session_id IS NOT NULL`;

    const session = rows[0];

    if (
      !session ||
      (browser &&
        (browser.sessionId !== session.sessionId ||
          browser.userId !== session.userId))
    )
      return yield* new ChannelAccountError({ reason: "session_invalid" });

    return yield* ctx.accounts.requireFreshSession(session);
  });

const makeSelect = (ctx: Pick<DeviceCtx, "sql">) =>
  Effect.fn("NativeDeviceAuth.select")(function* (id: string) {
    const rows = yield* ctx.sql<typeof Device.Type>`SELECT id, purpose, channel,
        to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
        to_char(browser_bound_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "browserBoundAt",
        to_char(confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "confirmedAt"
        FROM public.channel_auth_challenge WHERE id = ${id} AND intended_identity_id IS NOT NULL
        AND expires_at > clock_timestamp() AND cancelled_at IS NULL AND consumed_at IS NULL`;

    if (!rows[0]) return yield* invalid();

    return rows[0];
  });

const bindLinkSession = Effect.fn("NativeDeviceAuth.bindLinkSession")(
  function* (
    ctx: Pick<DeviceCtx, "accounts">,
    request: typeof Bind.Type,
    row: {
      readonly requestingSessionId: string | null;
    },
    owner: { readonly userId: string }
  ) {
    if (!request.link)
      return yield* new ChannelAccountError({
        reason: "session_invalid",
      });
    yield* ctx.accounts.requireFreshSession(request.link);

    if (owner.userId !== request.link.userId)
      return yield* new ChannelAccountError({
        reason: "account_conflict",
      });

    if (
      row.requestingSessionId !== null &&
      row.requestingSessionId !== request.link.sessionId
    )
      return yield* new ChannelAccountError({
        reason: "session_invalid",
      });

    return undefined;
  }
);

const makeIssue = (ctx: DeviceCtx) =>
  Effect.fn("NativeDeviceAuth.issue")(function* (input: typeof Issue.Type) {
    const request = yield* decode(Issue, input);
    const key = ctx.installation.betterAuthSecret;

    if (Redacted.value(key).length < 32) return yield* invalid();

    return yield* ctx.transaction(
      Effect.gen(function* () {
        const owner = yield* ctx.sourceIdentity(request);

        const existing = yield* ctx.sql<{
          id: string;
        }>`SELECT id FROM public.channel_auth_challenge
          WHERE intended_identity_id = ${owner.id} AND source_session_id = ${request.sessionId}
          AND source_call_id = ${request.callId}`;

        const id = existing[0]?.id ?? randomUUID();

        // Reproducible only for this random challenge ID; retries need no plaintext token storage.
        const token = createHmac("sha256", Redacted.value(key))
          .update(`companion-device-entry:${id}`)
          .digest("base64url");

        if (!existing.length) {
          yield* ctx.sql`INSERT INTO public.channel_auth_challenge
            (id, purpose, token_hash, intended_identity_id, entry_token_hash, source_session_id,
             source_call_id, channel, installation_id, expires_at, created_at)
            VALUES (${id}, ${request.purpose}, ${hash(token)}, ${owner.id}, ${hash(token)}, ${request.sessionId},
              ${request.callId}, ${owner.channel}, ${owner.installationId}, clock_timestamp() + interval '5 minutes', clock_timestamp())`;
        }

        const challenge = yield* ctx.select(id);

        if (challenge.purpose !== request.purpose) return yield* invalid();

        return {
          challenge,
          entryToken: challenge.browserBoundAt ? null : token,
        };
      })
    );
  });

interface BindRow {
  readonly identityId: string;
  readonly sessionId: string;
  readonly purpose: typeof Purpose.Type;
  readonly targetUserId: string | null;
  readonly requestingSessionId: string | null;
  readonly browserSecretHash: string | null;
  readonly entryTokenHash: string | null;
}

const loadBindRow = Effect.fn("NativeDeviceAuth.loadBindRow")(function* (
  ctx: Pick<DeviceCtx, "sql">,
  requestId: string
) {
  const rows =
    yield* ctx.sql<BindRow>`SELECT intended_identity_id AS "identityId", source_session_id AS "sessionId",
          purpose, target_user_id AS "targetUserId", requesting_session_id AS "requestingSessionId",
          browser_secret_hash AS "browserSecretHash", entry_token_hash AS "entryTokenHash"
          FROM public.channel_auth_challenge WHERE id = ${requestId} AND intended_identity_id IS NOT NULL
          AND confirmed_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL
          AND expires_at > clock_timestamp() FOR UPDATE`;

  return rows[0];
});

const bindPurposeGate = Effect.fn("NativeDeviceAuth.bindPurposeGate")(
  function* (
    ctx: Pick<DeviceCtx, "accounts">,
    request: typeof Bind.Type,
    row: BindRow,
    owner: { readonly userId: string }
  ) {
    if (row.purpose === "link") {
      yield* bindLinkSession(ctx, request, row, owner);

      return undefined;
    }

    if (request.link) return yield* invalid();

    return undefined;
  }
);

const bindExistingBrowser = Effect.fn("NativeDeviceAuth.bindExistingBrowser")(
  function* (
    ctx: Pick<DeviceCtx, "select">,
    request: typeof Bind.Type,
    row: BindRow
  ) {
    if (row.browserSecretHash === null) return undefined;

    if (row.browserSecretHash !== hash(request.browserSecret))
      return yield* invalid();

    return yield* ctx.select(request.id);
  }
);

const bindNewBrowser = Effect.fn("NativeDeviceAuth.bindNewBrowser")(function* (
  ctx: Pick<DeviceCtx, "sql" | "select">,
  request: typeof Bind.Type,
  row: BindRow
) {
  if (row.entryTokenHash !== hash(request.token)) return yield* invalid();

  const linkUserId = request.link?.userId ?? null;
  const linkSessionId = request.link?.sessionId ?? null;

  yield* ctx.sql`UPDATE public.channel_auth_challenge SET browser_secret_hash = ${hash(request.browserSecret)},
          browser_bound_at = clock_timestamp(), entry_token_hash = NULL,
          target_user_id = ${linkUserId}, requesting_session_id = ${linkSessionId}
          WHERE id = ${request.id}`;

  return yield* ctx.select(request.id);
});

const makeBind = (ctx: DeviceCtx) =>
  Effect.fn("NativeDeviceAuth.bind")(function* (input: typeof Bind.Type) {
    const request = yield* decode(Bind, input);

    return yield* ctx.transaction(
      Effect.gen(function* () {
        const row = yield* loadBindRow(ctx, request.id);

        if (!row || row.purpose !== request.purpose) return yield* invalid();
        const owner = yield* ctx.sourceIdentity(row);

        yield* bindPurposeGate(ctx, request, row, owner);

        const existing = yield* bindExistingBrowser(ctx, request, row);

        if (existing) return existing;

        return yield* bindNewBrowser(ctx, request, row);
      })
    );
  });

const makeResume = (ctx: DeviceCtx) =>
  Effect.fn("NativeDeviceAuth.resume")(function* (input: typeof Resume.Type) {
    const request = yield* decode(Resume, input);

    return yield* ctx.transaction(
      Effect.gen(function* () {
        const rows = yield* ctx.sql<{
          identityId: string;
          sessionId: string;
        }>`SELECT intended_identity_id AS "identityId", source_session_id AS "sessionId"
            FROM public.channel_auth_challenge WHERE id = ${request.id}
            AND intended_identity_id IS NOT NULL AND browser_secret_hash = ${hash(request.browserSecret)}`;

        if (!rows[0]) return yield* invalid();
        const owner = yield* ctx.sourceIdentity(rows[0]);
        const device = yield* ctx.select(request.id);

        if (device.purpose !== request.purpose) return yield* invalid();

        if (device.purpose === "link") {
          if (!request.link)
            return yield* new ChannelAccountError({
              reason: "session_invalid",
            });
          yield* ctx.requireBoundSession(
            request.id,
            owner.userId,
            request.link
          );
        } else if (request.link) return yield* invalid();

        return device;
      })
    );
  });

const makePending = (ctx: DeviceCtx) =>
  Effect.fn("NativeDeviceAuth.pending")(function* (input: typeof Source.Type) {
    const request = yield* decode(Source, input);

    return yield* ctx.transaction(
      Effect.gen(function* () {
        yield* ctx.sourceIdentity(request);

        const rows = yield* ctx.sql<{
          id: string;
        }>`SELECT id FROM public.channel_auth_challenge
          WHERE intended_identity_id = ${request.identityId} AND source_session_id = ${request.sessionId}
          AND browser_bound_at IS NOT NULL AND confirmed_at IS NULL AND consumed_at IS NULL
          AND cancelled_at IS NULL AND expires_at > clock_timestamp() ORDER BY browser_bound_at DESC LIMIT 10`;

        return yield* Effect.forEach(rows, (row) => ctx.select(row.id), {
          concurrency: 1,
        });
      })
    );
  });

const makeConfirm = (ctx: DeviceCtx) =>
  Effect.fn("NativeDeviceAuth.confirm")(function* (
    input: typeof Selection.Type
  ) {
    const request = yield* decode(Selection, input);

    return yield* ctx.transaction(
      Effect.gen(function* () {
        const owner = yield* ctx.sourceIdentity(request);
        const device = yield* ctx.select(request.challengeId);

        if (device.purpose !== request.purpose) return yield* invalid();

        if (device.purpose === "link")
          yield* ctx.requireBoundSession(request.challengeId, owner.userId);

        const rows = yield* ctx.sql`UPDATE public.channel_auth_challenge
          SET confirmed_at = COALESCE(confirmed_at, clock_timestamp()), confirmed_sender_id = ${owner.senderId}
          WHERE id = ${request.challengeId} AND purpose = ${request.purpose} AND intended_identity_id = ${owner.id}
          AND source_session_id = ${request.sessionId} AND browser_bound_at IS NOT NULL
          AND to_char(browser_bound_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = ${request.browserBoundAt}
          AND browser_secret_hash IS NOT NULL AND entry_token_hash IS NULL
          AND cancelled_at IS NULL AND consumed_at IS NULL AND expires_at > clock_timestamp()
          RETURNING id`;

        if (!rows.length) return yield* invalid();

        return { confirmed: true as const };
      })
    );
  });

function buildNativeDeviceAuth(
  sql: PgClient.PgClient,
  accounts: DeviceAccounts,
  installation: DeviceInstallation
) {
  const base = {
    sql,
    accounts,
    installation,
    transaction: makeTransaction(sql),
  };

  const identity: DeviceCtx["identity"] = makeIdentity(base);

  const sourceIdentity: DeviceCtx["sourceIdentity"] = makeSourceIdentity({
    sql,
    identity,
  });

  const requireBoundSession: DeviceCtx["requireBoundSession"] =
    makeRequireBoundSession(base);

  const select: DeviceCtx["select"] = makeSelect(base);

  const ctx: DeviceCtx = {
    ...base,
    identity,
    sourceIdentity,
    requireBoundSession,
    select,
  };

  return {
    issue: makeIssue(ctx),
    bind: makeBind(ctx),
    resume: makeResume(ctx),
    pending: makePending(ctx),
    confirm: makeConfirm(ctx),
  };
}

export class NativeDeviceAuth extends Context.Service<
  NativeDeviceAuth,
  {
    readonly issue: (input: typeof Issue.Type) => Effect.Effect<
      {
        readonly challenge: typeof Device.Type;
        readonly entryToken: string | null;
      },
      Failure
    >;
    readonly bind: (
      input: typeof Bind.Type
    ) => Effect.Effect<typeof Device.Type, Failure>;
    readonly resume: (
      input: typeof Resume.Type
    ) => Effect.Effect<typeof Device.Type, Failure>;
    readonly pending: (
      input: typeof Source.Type
    ) => Effect.Effect<readonly (typeof Device.Type)[], Failure>;
    readonly confirm: (
      input: typeof Selection.Type
    ) => Effect.Effect<{ readonly confirmed: true }, Failure>;
  }
>()("companion/NativeDeviceAuth") {
  static readonly layer = Layer.effect(
    NativeDeviceAuth,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const accounts = yield* ChannelAccounts;
      const installation = yield* ResolvedInstallationSecrets;

      return NativeDeviceAuth.of(
        buildNativeDeviceAuth(sql, accounts, installation)
      );
    })
  );
}

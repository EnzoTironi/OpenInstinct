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

      const transaction = <A, E>(operation: Effect.Effect<A, E>) =>
        sql.withTransaction(
          Effect.gen(function* () {
            // Same account lifecycle lock as ChannelAccounts; no provider I/O under it.
            yield* sql`SELECT pg_advisory_xact_lock(724193, 1)`;

            return yield* operation;
          })
        );

      const identity = Effect.fn("NativeDeviceAuth.identity")(function* (
        id: string
      ) {
        const rows = yield* sql<{
          channel: "telegram" | "kapso";
          installationId: string;
          senderId: string;
        }>`SELECT channel, installation_id AS "installationId", sender_id AS "senderId"
        FROM public.channel_identity WHERE id = ${id} AND revoked_at IS NULL`;

        if (!rows[0]) return yield* invalid();

        return yield* accounts.getActiveIdentity(rows[0]);
      });

      const sourceIdentity = Effect.fn("NativeDeviceAuth.sourceIdentity")(
        function* (source: typeof Source.Type) {
          const owner = yield* identity(source.identityId);
          const principalId = `better-auth:${owner.userId}`;

          const rows = yield* sql`SELECT s.session_id FROM agent_sessions s
        JOIN workspace_memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.created_by_user_id
        WHERE s.session_id = ${source.sessionId} AND s.created_by_user_id = ${principalId}
        AND s.workspace_id = ${accessScopeForUser(principalId).workspaceId}`;

          if (!rows.length) return yield* invalid();

          return owner;
        }
      );

      const requireBoundSession = Effect.fn(
        "NativeDeviceAuth.requireBoundSession"
      )(function* (
        id: string,
        userId: string,
        browser?: typeof BrowserSession.Type
      ) {
        const rows = yield* sql<
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

        return yield* accounts.requireFreshSession(session);
      });

      const select = Effect.fn("NativeDeviceAuth.select")(function* (
        id: string
      ) {
        const rows = yield* sql<typeof Device.Type>`SELECT id, purpose, channel,
        to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
        to_char(browser_bound_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "browserBoundAt",
        to_char(confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "confirmedAt"
        FROM public.channel_auth_challenge WHERE id = ${id} AND intended_identity_id IS NOT NULL
        AND expires_at > clock_timestamp() AND cancelled_at IS NULL AND consumed_at IS NULL`;

        if (!rows[0]) return yield* invalid();

        return rows[0];
      });

      const issue = Effect.fn("NativeDeviceAuth.issue")(function* (
        input: typeof Issue.Type
      ) {
        const request = yield* decode(Issue, input);
        const key = installation.betterAuthSecret;

        if (Redacted.value(key).length < 32) return yield* invalid();

        return yield* transaction(
          Effect.gen(function* () {
            const owner = yield* sourceIdentity(request);

            const existing = yield* sql<{
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
              yield* sql`INSERT INTO public.channel_auth_challenge
            (id, purpose, token_hash, intended_identity_id, entry_token_hash, source_session_id,
             source_call_id, channel, installation_id, expires_at, created_at)
            VALUES (${id}, ${request.purpose}, ${hash(token)}, ${owner.id}, ${hash(token)}, ${request.sessionId},
              ${request.callId}, ${owner.channel}, ${owner.installationId}, clock_timestamp() + interval '5 minutes', clock_timestamp())`;
            }

            const challenge = yield* select(id);

            if (challenge.purpose !== request.purpose) return yield* invalid();

            return {
              challenge,
              entryToken: challenge.browserBoundAt ? null : token,
            };
          })
        );
      });

      const bind = Effect.fn("NativeDeviceAuth.bind")(function* (
        input: typeof Bind.Type
      ) {
        const request = yield* decode(Bind, input);

        return yield* transaction(
          Effect.gen(function* () {
            const rows = yield* sql<{
              identityId: string;
              sessionId: string;
              purpose: typeof Purpose.Type;
              targetUserId: string | null;
              requestingSessionId: string | null;
              browserSecretHash: string | null;
              entryTokenHash: string | null;
            }>`SELECT intended_identity_id AS "identityId", source_session_id AS "sessionId",
          purpose, target_user_id AS "targetUserId", requesting_session_id AS "requestingSessionId",
          browser_secret_hash AS "browserSecretHash", entry_token_hash AS "entryTokenHash"
          FROM public.channel_auth_challenge WHERE id = ${request.id} AND intended_identity_id IS NOT NULL
          AND confirmed_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL
          AND expires_at > clock_timestamp() FOR UPDATE`;

            const row = rows[0];

            if (!row || row.purpose !== request.purpose)
              return yield* invalid();
            const owner = yield* sourceIdentity(row);

            if (row.purpose === "link") {
              if (!request.link)
                return yield* new ChannelAccountError({
                  reason: "session_invalid",
                });
              yield* accounts.requireFreshSession(request.link);

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
            } else if (request.link) return yield* invalid();

            if (row.browserSecretHash !== null) {
              if (row.browserSecretHash !== hash(request.browserSecret))
                return yield* invalid();

              return yield* select(request.id);
            }

            if (row.entryTokenHash !== hash(request.token))
              return yield* invalid();
            yield* sql`UPDATE public.channel_auth_challenge SET browser_secret_hash = ${hash(request.browserSecret)},
          browser_bound_at = clock_timestamp(), entry_token_hash = NULL,
          target_user_id = ${request.link?.userId ?? null}, requesting_session_id = ${request.link?.sessionId ?? null}
          WHERE id = ${request.id}`;

            return yield* select(request.id);
          })
        );
      });

      const resume = Effect.fn("NativeDeviceAuth.resume")(function* (
        input: typeof Resume.Type
      ) {
        const request = yield* decode(Resume, input);

        return yield* transaction(
          Effect.gen(function* () {
            const rows = yield* sql<{
              identityId: string;
              sessionId: string;
            }>`SELECT intended_identity_id AS "identityId", source_session_id AS "sessionId"
            FROM public.channel_auth_challenge WHERE id = ${request.id}
            AND intended_identity_id IS NOT NULL AND browser_secret_hash = ${hash(request.browserSecret)}`;

            if (!rows[0]) return yield* invalid();
            const owner = yield* sourceIdentity(rows[0]);
            const device = yield* select(request.id);

            if (device.purpose !== request.purpose) return yield* invalid();

            if (device.purpose === "link") {
              if (!request.link)
                return yield* new ChannelAccountError({
                  reason: "session_invalid",
                });
              yield* requireBoundSession(
                request.id,
                owner.userId,
                request.link
              );
            } else if (request.link) return yield* invalid();

            return device;
          })
        );
      });

      const pending = Effect.fn("NativeDeviceAuth.pending")(function* (
        input: typeof Source.Type
      ) {
        const request = yield* decode(Source, input);

        return yield* transaction(
          Effect.gen(function* () {
            yield* sourceIdentity(request);

            const rows = yield* sql<{
              id: string;
            }>`SELECT id FROM public.channel_auth_challenge
          WHERE intended_identity_id = ${request.identityId} AND source_session_id = ${request.sessionId}
          AND browser_bound_at IS NOT NULL AND confirmed_at IS NULL AND consumed_at IS NULL
          AND cancelled_at IS NULL AND expires_at > clock_timestamp() ORDER BY browser_bound_at DESC LIMIT 10`;

            return yield* Effect.forEach(rows, (row) => select(row.id), {
              concurrency: 1,
            });
          })
        );
      });

      const confirm = Effect.fn("NativeDeviceAuth.confirm")(function* (
        input: typeof Selection.Type
      ) {
        const request = yield* decode(Selection, input);

        return yield* transaction(
          Effect.gen(function* () {
            const owner = yield* sourceIdentity(request);
            const device = yield* select(request.challengeId);

            if (device.purpose !== request.purpose) return yield* invalid();

            if (device.purpose === "link")
              yield* requireBoundSession(request.challengeId, owner.userId);

            const rows = yield* sql`UPDATE public.channel_auth_challenge
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

      return NativeDeviceAuth.of({ issue, bind, resume, pending, confirm });
    })
  );
}

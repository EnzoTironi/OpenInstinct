import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { auth as google } from "@googleapis/gmail";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { DateTime, Effect, Redacted, Schema } from "effect";
import { authentication } from "@db/services/auth";
import { env } from "@shared/environment";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import {
  getGoogleWorkspaceToken,
  hasGoogleWorkspaceScopes,
  GoogleWorkspaceError,
} from "../google-workspace";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { readWorkspaceCapabilities } from "./capabilities";
import { WorkspaceRepository } from "./repository";
import { capabilitiesPath } from "../../shared/workspaces/capabilities";

const CredentialsSchema = Schema.Struct({
  workspaceId: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
});
const decodeCredentials = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CredentialsSchema)
);
const accountSchema = Schema.Struct({
  id: Schema.String,
  accountId: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  scope: Schema.NullOr(Schema.String),
});
// Google's tokeninfo wire response can contain "true" despite the SDK's boolean type.
const verifiedGoogleEmail = Schema.is(Schema.Literals([true, "true"]));

export const readWorkspaceConnections = Effect.fn("readWorkspaceConnections")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const access = yield* requireWorkspaceAccess(actor);
    const sql = yield* PgClient.PgClient;
    const rows =
      yield* sql`SELECT provider, label FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`;
    return {
      connections: yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            provider: Schema.Literal("google"),
            label: Schema.String,
          })
        )
      )(rows),
      mayManage: access.role !== "member",
    };
  }
);

/** An explicit admin action copies a provider grant into workspace custody. */
export const shareGoogleConnection = Effect.fn("shareGoogleConnection")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const access = yield* requireWorkspaceAccess(actor, true);
    if (!access.organizationId || !actor.authSessionId)
      return yield* new WorkspaceAccessDenied();
    const token = Redacted.value(
      yield* getGoogleWorkspaceToken(accessScopeForUser(actor.userId))
    );
    const sql = yield* PgClient.PgClient;
    const rows =
      yield* sql`SELECT a.id, a."accountId", a."refreshToken", a.scope FROM account a JOIN public.user u ON u.id = a."userId"
    WHERE ('better-auth:' || u.id) = ${actor.userId} AND a."providerId" = 'google' AND a.issuer = 'https://accounts.google.com' LIMIT 2`;
    if (rows.length !== 1)
      return yield* new GoogleWorkspaceError({
        reason: "authorization_required",
      });
    const account = yield* Schema.decodeUnknownEffect(accountSchema)(rows[0]);
    if (!account.refreshToken || !hasGoogleWorkspaceScopes(account.scope))
      return yield* new GoogleWorkspaceError({
        reason: "authorization_required",
      });
    const encryptedRefreshToken = account.refreshToken;
    const identity = yield* Effect.tryPromise({
      try: () =>
        new google.OAuth2(env.GOOGLE_CLIENT_ID).getTokenInfo(token.token),
      catch: () =>
        new GoogleWorkspaceError({ reason: "authorization_required" }),
    }).pipe(Effect.timeout("20 seconds"));
    if (
      !identity.email ||
      !verifiedGoogleEmail(identity.email_verified) ||
      identity.aud !== env.GOOGLE_CLIENT_ID ||
      identity.sub !== account.accountId
    ) {
      return yield* new GoogleWorkspaceError({
        reason: "authorization_required",
      });
    }
    const auth = yield* authentication;
    const credentials = yield* Effect.tryPromise({
      try: async () => {
        const key = (await auth.$context).secretConfig;
        const refreshToken = await symmetricDecrypt({
          data: encryptedRefreshToken,
          key,
        });
        return symmetricEncrypt({
          key,
          data: JSON.stringify({
            workspaceId: actor.workspaceId,
            accessToken: token.token,
            refreshToken,
            expiresAt: token.expiresAt ?? 0,
          }),
        });
      },
      catch: () => new GoogleWorkspaceError({ reason: "unavailable" }),
    });
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        const source =
          yield* sql`SELECT id FROM account WHERE id = ${account.id}
          AND ('better-auth:' || "userId") = ${actor.userId} AND "refreshToken" = ${encryptedRefreshToken} FOR SHARE`;
        if (source.length !== 1)
          return yield* new GoogleWorkspaceError({
            reason: "authorization_required",
          });
        const capabilities = yield* readWorkspaceCapabilities(actor);
        if (!capabilities.enabled.includes("google")) {
          yield* (yield* WorkspaceRepository).write(actor, {
            operationId: randomUUID(),
            expectedRevision: capabilities.revision,
            path: capabilitiesPath,
            content: JSON.stringify(
              { version: 1, enabled: [...capabilities.enabled, "google"] },
              null,
              2
            ),
          });
        }
        yield* sql`INSERT INTO workspace_connections(workspace_id, provider, label, credentials, connected_by)
      VALUES (${actor.workspaceId}, 'google', ${identity.email}, ${credentials}, ${actor.userId})
      ON CONFLICT (workspace_id) DO UPDATE SET label = EXCLUDED.label, credentials = EXCLUDED.credentials,
        connected_by = EXCLUDED.connected_by, revision = ${randomUUID()}, updated_at = now()`;
        return { connected: true };
      })
    );
  }
);

export const disconnectWorkspaceGoogle = Effect.fn("disconnectWorkspaceGoogle")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        yield* sql`DELETE FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`;
        // Google revocation would also revoke the same person's other grants to this
        // OAuth client. Disconnect here removes only this explicitly shared copy.
        return { disconnected: true };
      })
    );
  }
);

export const getWorkspaceGoogleToken = Effect.fn("getWorkspaceGoogleToken")(
  function* (scope: AccessScope) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        // Serialize refreshes across processes without locking revocation or re-sharing.
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.workspaceId}, 3))`;
        const rows = yield* sql<{
          credentials: string;
          revision: string;
        }>`SELECT c.credentials, c.revision FROM workspace_connections c
    JOIN workspace_memberships m ON m.workspace_id = c.workspace_id AND m.user_id = ${scope.userId}
    JOIN workspaces w ON w.id = c.workspace_id JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
    WHERE c.workspace_id = ${scope.workspaceId}`;
        const row = rows[0];
        if (!row)
          return yield* new GoogleWorkspaceError({
            reason: "authorization_required",
          });
        const auth = yield* authentication;
        const payload = yield* Effect.tryPromise({
          try: async () =>
            Redacted.make(
              await symmetricDecrypt({
                data: row.credentials,
                key: (await auth.$context).secretConfig,
              })
            ),
          catch: () => new GoogleWorkspaceError({ reason: "unavailable" }),
        });
        let credentials = yield* decodeCredentials(Redacted.value(payload));
        if (credentials.workspaceId !== scope.workspaceId)
          return yield* new GoogleWorkspaceError({ reason: "unauthenticated" });
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        if (credentials.expiresAt < now + 60_000) {
          const updated = yield* Effect.tryPromise({
            try: async () => {
              const client = new google.OAuth2(
                env.GOOGLE_CLIENT_ID,
                env.GOOGLE_CLIENT_SECRET
                  ? Redacted.value(env.GOOGLE_CLIENT_SECRET)
                  : undefined
              );
              client.setCredentials({
                refresh_token: credentials.refreshToken,
              });
              return Redacted.make(
                (await client.refreshAccessToken()).credentials
              );
            },
            catch: () =>
              new GoogleWorkspaceError({ reason: "authorization_required" }),
          }).pipe(Effect.timeout("20 seconds"));
          const refreshed = Redacted.value(updated);
          if (!refreshed.access_token || !refreshed.expiry_date)
            return yield* new GoogleWorkspaceError({
              reason: "authorization_required",
            });
          credentials = {
            ...credentials,
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token ?? credentials.refreshToken,
            expiresAt: refreshed.expiry_date,
          };
          const encrypted = yield* Effect.tryPromise({
            try: async () =>
              symmetricEncrypt({
                data: JSON.stringify(credentials),
                key: (await auth.$context).secretConfig,
              }),
            catch: () => new GoogleWorkspaceError({ reason: "unavailable" }),
          });
          const saved =
            yield* sql`UPDATE workspace_connections SET credentials = ${encrypted}, updated_at = now()
      WHERE workspace_id = ${scope.workspaceId} AND revision = ${row.revision} RETURNING workspace_id`;
          if (!saved.length)
            return yield* new GoogleWorkspaceError({
              reason: "authorization_required",
            });
        }
        const current =
          yield* sql`SELECT c.workspace_id FROM workspace_connections c
    JOIN workspace_memberships m ON m.workspace_id = c.workspace_id AND m.user_id = ${scope.userId}
    JOIN workspaces w ON w.id = c.workspace_id JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
    WHERE c.workspace_id = ${scope.workspaceId} AND c.revision = ${row.revision}`;
        if (!current.length)
          return yield* new GoogleWorkspaceError({
            reason: "authorization_required",
          });
        return Redacted.make({
          token: credentials.accessToken,
          expiresAt: credentials.expiresAt,
        });
      })
    );
  }
);

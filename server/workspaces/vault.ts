import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { DateTime, Effect, Redacted, Schema } from "effect";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { readVaultItem, readVaultSecret } from "@db/services/vault";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

export class VaultwardenUnavailable extends Schema.TaggedError<VaultwardenUnavailable>()(
  "VaultwardenUnavailable",
  {}
) {}

export const DelegateVaultItemSchema = Schema.Struct({
  itemId: Schema.String.check(Schema.isUUID()),
  days: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
});
const delegatedItemSchema = Schema.Struct({
  account: Schema.String,
  available: Schema.Boolean,
  handle: Schema.String,
  kind: Schema.String,
  label: Schema.String,
});

const installationKey = Effect.fn("vaultAgentInstallationKey")(function* () {
  const secrets = yield* ResolvedInstallationSecrets;
  return Buffer.from(Redacted.value(secrets.secretEncryptionKey), "base64");
});

/**
 * Vaultwarden is a Bitwarden-compatible server. Collection membership there is a
 * server ACL around the organization key, not a per-item wrapping key. Zoen
 * does not speak to a homeserver until a live instance proves that handshake.
 */
export const requireVaultwarden = Effect.fn("requireVaultwarden")(function* () {
  return yield* new VaultwardenUnavailable();
});

export const listDelegatedVaultItems = Effect.fn("listDelegatedVaultItems")(
  function* (scope: AccessScope) {
    yield* requireWorkspaceMember(scope);
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql<{
      account: string;
      handle: string;
      kind: string;
      label: string;
    }>`SELECT i.account, i.id AS handle, i.kind, i.label
      FROM vault_item_delegations d
      JOIN vault_agent_identities a ON a.id = d.identity_id
      JOIN vault_items i ON i.id = d.item_id AND i.workspace_id = d.workspace_id
      WHERE d.workspace_id = ${scope.workspaceId} AND d.revoked_at IS NULL
        AND a.revoked_at IS NULL AND d.expires_at > now()
      ORDER BY i.label`;
    return yield* Schema.decodeUnknownEffect(Schema.Array(delegatedItemSchema))(
      rows.map((row) => ({
        account: row.account,
        available: true,
        handle: row.handle,
        kind: row.kind,
        label: row.label,
      }))
    );
  }
);

export const inspectVaultDelegations = Effect.fn("inspectVaultDelegations")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const access = yield* requireWorkspaceAccess(actor);
    const sql = yield* PgClient.PgClient;
    const rows =
      yield* sql`SELECT d.id, d.item_id AS "itemId", d.expires_at::text AS "expiresAt"
      FROM vault_item_delegations d JOIN vault_agent_identities a ON a.id = d.identity_id
      WHERE d.workspace_id = ${actor.workspaceId} AND a.workspace_id = d.workspace_id
        AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND d.expires_at > now()`;
    return {
      mayManage:
        access.role !== "member" &&
        !!actor.authSessionId &&
        !actor.groupBindingId,
      items: yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            itemId: Schema.String,
            expiresAt: Schema.String,
          })
        )
      )(rows),
    };
  }
);

export const delegateVaultItem = Effect.fn("delegateVaultItem")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof DelegateVaultItemSchema.Type
) {
  const input = yield* Schema.decodeUnknownEffect(DelegateVaultItemSchema)(raw);
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vault-delegation:${actor.workspaceId}`}, 0))`;
      yield* requireWorkspaceAccess(actor, true);
      const previous = yield* sql<{
        id: string;
      }>`SELECT d.id FROM vault_item_delegations d
        JOIN vault_agent_identities a ON a.id = d.identity_id
        WHERE d.workspace_id = ${actor.workspaceId} AND d.item_id = ${input.itemId}
          AND a.revoked_at IS NULL AND d.revoked_at IS NULL AND d.expires_at > now()`;
      if (previous[0]) return { id: previous[0].id };
      const scope = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      };
      const item = yield* Effect.tryPromise({
        try: () => readVaultItem(scope, input.itemId),
        catch: () => new WorkspaceAccessDenied(),
      });
      if (!item) return yield* new WorkspaceAccessDenied();
      const secret = yield* Effect.tryPromise({
        try: () => readVaultSecret(scope, input.itemId),
        catch: () => new WorkspaceAccessDenied(),
      });
      if (!secret) return yield* new WorkspaceAccessDenied();
      const identity = yield* ensureAgentIdentity(scope);
      yield* sql`UPDATE vault_item_delegations SET revoked_at = clock_timestamp(), wrapped_secret = 'revoked'
        WHERE identity_id = ${identity.id} AND item_id = ${input.itemId}
          AND revoked_at IS NULL AND expires_at <= now()`;
      const grantId = randomUUID();
      const expiresAt = DateTime.toDateUtc(
        DateTime.add(yield* DateTime.now, { days: input.days })
      );
      const wrappedSecret = seal(
        identity.plaintext,
        secret,
        delegateAad(identity.id, input.itemId, grantId)
      );
      yield* sql`INSERT INTO vault_item_delegations(id, identity_id, item_id, workspace_id, wrapped_secret, issued_by, expires_at)
        VALUES (${grantId}, ${identity.id}, ${input.itemId}, ${actor.workspaceId}, ${wrappedSecret}, ${actor.userId}, ${expiresAt})`;
      return { id: grantId };
    })
  );
});

export const revokeVaultDelegation = Effect.fn("revokeVaultDelegation")(
  function* (actor: typeof WorkspaceActorSchema.Type, id: string) {
    const grantId = yield* Schema.decodeUnknownEffect(
      Schema.String.check(Schema.isUUID())
    )(id).pipe(Effect.mapError(() => new WorkspaceAccessDenied()));
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requireWorkspaceAccess(actor, true);
        const rows =
          yield* sql`UPDATE vault_item_delegations SET revoked_at = clock_timestamp(), wrapped_secret = 'revoked'
          WHERE id = ${grantId} AND workspace_id = ${actor.workspaceId} RETURNING id`;
        if (!rows.length) return yield* new WorkspaceAccessDenied();
        return { revoked: true };
      })
    );
  }
);

export const releaseDelegatedSecret = Effect.fn("releaseDelegatedSecret")(
  function* (scope: AccessScope, itemId: string) {
    yield* requireWorkspaceMember(scope);
    const handle = yield* Schema.decodeUnknownEffect(
      Schema.String.check(Schema.isUUID())
    )(itemId).pipe(Effect.mapError(() => new WorkspaceAccessDenied()));
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql<{
      id: string;
      identity_id: string;
      wrapping_key: string;
      wrapped_secret: string;
    }>`SELECT d.id, a.id AS identity_id, a.wrapping_key, d.wrapped_secret
      FROM vault_item_delegations d
      JOIN vault_agent_identities a ON a.id = d.identity_id
      WHERE d.item_id = ${handle} AND d.workspace_id = ${scope.workspaceId}
        AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND d.expires_at > now()
        AND a.workspace_id = ${scope.workspaceId}
      FOR SHARE OF d, a`;
    const grant = rows[0];
    if (!grant) return yield* new WorkspaceAccessDenied();
    const key = yield* installationKey();
    const identityKey = yield* unwrapIdentityKey(
      key,
      grant.wrapping_key,
      identityAad(scope.workspaceId, grant.identity_id)
    );
    const secret = yield* openEnvelope(
      identityKey,
      grant.wrapped_secret,
      delegateAad(grant.identity_id, handle, grant.id)
    );
    return Redacted.make(secret.toString("utf8"));
  }
);

const requireWorkspaceMember = Effect.fn("requireVaultWorkspaceMember")(
  function* (scope: AccessScope) {
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql`SELECT 1 FROM workspace_memberships
      WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId} FOR SHARE`;
    if (!rows.length) return yield* new WorkspaceAccessDenied();
    return true;
  }
);

const ensureAgentIdentity = Effect.fn("ensureVaultAgentIdentity")(function* (
  scope: AccessScope
) {
  const sql = yield* PgClient.PgClient;
  const existing = yield* sql<{
    id: string;
    wrapping_key: string;
  }>`SELECT id, wrapping_key FROM vault_agent_identities
    WHERE workspace_id = ${scope.workspaceId} AND revoked_at IS NULL FOR UPDATE`;
  const key = yield* installationKey();
  if (existing[0]) {
    const plaintext = yield* unwrapIdentityKey(
      key,
      existing[0].wrapping_key,
      identityAad(scope.workspaceId, existing[0].id)
    );
    return { id: existing[0].id, plaintext };
  }
  const id = randomUUID();
  const plaintext = randomBytes(32);
  const wrappingKey = seal(
    key,
    plaintext.toString("base64"),
    identityAad(scope.workspaceId, id)
  );
  yield* sql`INSERT INTO vault_agent_identities(id, workspace_id, wrapping_key)
    VALUES (${id}, ${scope.workspaceId}, ${wrappingKey})`;
  return { id, plaintext };
});

function unwrapIdentityKey(
  installation: Buffer,
  wrappingKey: string,
  aad: string
) {
  return Effect.gen(function* () {
    const wrapped = yield* openEnvelope(installation, wrappingKey, aad);
    const plaintext = Buffer.from(wrapped.toString("utf8"), "base64");
    if (plaintext.length !== 32) return yield* new WorkspaceAccessDenied();
    return plaintext;
  });
}

function identityAad(workspaceId: string, identityId: string) {
  return `vault-agent\u0000${workspaceId}\u0000${identityId}`;
}

function delegateAad(identityId: string, itemId: string, grantId: string) {
  return `vault-delegate\u0000${identityId}\u0000${itemId}\u0000${grantId}`;
}

function seal(key: Buffer, value: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function openEnvelope(key: Buffer, value: string, aad: string) {
  return Effect.try({
    try: () => {
      const [version, encodedIv, encodedTag, encodedCiphertext] =
        value.split(".");
      if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
        throw new Error("unsupported");
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(encodedIv, "base64url")
      );
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
      ]);
    },
    catch: () => new WorkspaceAccessDenied(),
  });
}

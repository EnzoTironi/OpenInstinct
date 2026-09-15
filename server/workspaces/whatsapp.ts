import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { DateTime, Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

export class WhatsAppBridgeUnavailable extends Schema.TaggedError<WhatsAppBridgeUnavailable>()(
  "WhatsAppBridgeUnavailable",
  {}
) {}

const remoteId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128)
);
const messageBody = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8000)
);
const uuid = Schema.String.check(Schema.isUUID());
export const ConfirmWhatsAppPairingSchema = Schema.Struct({
  accountId: uuid,
  pairingNonce: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200)
  ),
  remoteUserId: remoteId,
});
export const AuthorizeWhatsAppChatSchema = Schema.Struct({
  remoteChatId: remoteId,
  kind: Schema.Literals(["dm", "group"]),
});
export const IngestWhatsAppEventSchema = Schema.Struct({
  accountId: uuid,
  remoteChatId: remoteId,
  providerEventId: remoteId,
  kind: Schema.Literals(["backfill", "live"]),
  authorRemoteId: remoteId,
  body: messageBody,
});
export const WhatsAppChatIdSchema = Schema.Struct({ chatId: uuid });
export const ShareWhatsAppChatSchema = Schema.Struct({
  chatId: uuid,
  workspaceId: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200)
  ),
});
export const ImportWhatsAppContactsSchema = Schema.Struct({
  contacts: Schema.Array(
    Schema.Struct({
      remoteUserId: remoteId,
      name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
    })
  ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
export const WhatsAppDraftSchema = Schema.Struct({
  chatId: uuid,
  body: messageBody,
});
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" });

const chatSchema = Schema.Struct({
  handle: Schema.String,
  kind: Schema.String,
  remoteChatId: Schema.String,
});
const accountSchema = Schema.Struct({
  available: Schema.Boolean,
  handle: Schema.String,
  remoteUserId: Schema.NullOr(Schema.String),
  status: Schema.String,
});

/**
 * mautrix-whatsapp is the candidate user-owned WhatsApp bridge. Pairing a
 * person's WhatsApp is not the Kapso Cloud API bot and is not a Beeper Desktop
 * channel. This checkout has no live bridge, so homeserver I/O fails closed.
 */
export const requireWhatsAppBridge = Effect.fn("requireWhatsAppBridge")(
  function* () {
    return yield* new WhatsAppBridgeUnavailable();
  }
);

export const listWhatsAppAccounts = Effect.fn("listWhatsAppAccounts")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    yield* requireWorkspaceAccess(actor);
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql<{
      handle: string;
      remote_user_id: string | null;
      status: string;
    }>`SELECT id AS handle, remote_user_id, status
      FROM whatsapp_bridge_accounts
      WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`;
    return yield* Schema.decodeUnknownEffect(Schema.Array(accountSchema))(
      rows.map((row) => ({
        available: row.status === "connected",
        handle: row.handle,
        remoteUserId: row.remote_user_id,
        status: row.status,
      }))
    );
  }
);

export const startWhatsAppPairing = Effect.fn("startWhatsAppPairing")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const access = yield* requirePersonalOwner(actor);
        yield* sql`UPDATE whatsapp_bridge_accounts
          SET status = 'revoked', revoked_at = clock_timestamp(), pairing_nonce_hash = 'revoked'
          WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
            AND status = 'pairing' AND expires_at <= now()`;
        const nonce = randomBytes(32).toString("base64url");
        const id = randomUUID();
        const expiresAt = DateTime.toDateUtc(
          DateTime.add(yield* DateTime.now, { minutes: 15 })
        );
        yield* sql`INSERT INTO whatsapp_bridge_accounts(
            id, workspace_id, user_id, pairing_nonce_hash, status, expires_at
          ) VALUES (
            ${id}, ${actor.workspaceId}, ${access.userId}, ${hashNonce(nonce)},
            'pairing', ${expiresAt}
          )`.pipe(Effect.catch(() => new WorkspaceAccessDenied()));
        return { id, pairingNonce: nonce };
      })
    );
  }
);

export const confirmWhatsAppPairing = Effect.fn("confirmWhatsAppPairing")(
  function* (raw: typeof ConfirmWhatsAppPairingSchema.Type) {
    const input = yield* decode(ConfirmWhatsAppPairingSchema)(raw);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<{
          pairing_nonce_hash: string;
        }>`SELECT pairing_nonce_hash FROM whatsapp_bridge_accounts
          WHERE id = ${input.accountId} AND status = 'pairing' AND revoked_at IS NULL
            AND expires_at > now() FOR UPDATE`;
        const account = rows[0];
        if (
          !account ||
          account.pairing_nonce_hash !== hashNonce(input.pairingNonce)
        )
          return yield* new WorkspaceAccessDenied();
        const updated = yield* sql`UPDATE whatsapp_bridge_accounts
            SET status = 'connected', remote_user_id = ${input.remoteUserId},
              connected_at = clock_timestamp()
            WHERE id = ${input.accountId} AND status = 'pairing' AND revoked_at IS NULL
            RETURNING id`.pipe(Effect.catch(() => new WorkspaceAccessDenied()));
        if (!updated.length) return yield* new WorkspaceAccessDenied();
        return { connected: true as const };
      })
    );
  }
);

export const authorizeWhatsAppChat = Effect.fn("authorizeWhatsAppChat")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof AuthorizeWhatsAppChatSchema.Type
  ) {
    const input = yield* decode(AuthorizeWhatsAppChatSchema)(raw);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const account = yield* requireAccount(actor, true);
        const existing = yield* sql<{
          id: string;
        }>`SELECT id FROM whatsapp_bridge_chats
          WHERE account_id = ${account.id} AND remote_chat_id = ${input.remoteChatId}
            AND revoked_at IS NULL FOR UPDATE`;
        if (existing[0]) return { id: existing[0].id };
        const id = randomUUID();
        yield* sql`INSERT INTO whatsapp_bridge_chats(id, account_id, remote_chat_id, kind)
          VALUES (${id}, ${account.id}, ${input.remoteChatId}, ${input.kind})`;
        return { id };
      })
    );
  }
);

export const listWhatsAppChats = Effect.fn("listWhatsAppChats")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const access = yield* requireWorkspaceAccess(actor);
  const sql = yield* PgClient.PgClient;
  const rows = access.organizationId
    ? yield* sql<{
        handle: string;
        kind: string;
        remote_chat_id: string;
      }>`SELECT c.id AS handle, c.kind, c.remote_chat_id
        FROM whatsapp_bridge_shares s
        JOIN whatsapp_bridge_chats c ON c.id = s.chat_id
        JOIN whatsapp_bridge_accounts a ON a.id = c.account_id
        WHERE s.workspace_id = ${actor.workspaceId} AND s.revoked_at IS NULL
          AND c.revoked_at IS NULL AND a.revoked_at IS NULL
          AND a.status IN ('connected', 'paused')
        ORDER BY c.remote_chat_id`
    : yield* sql<{
        handle: string;
        kind: string;
        remote_chat_id: string;
      }>`SELECT c.id AS handle, c.kind, c.remote_chat_id
        FROM whatsapp_bridge_chats c
        JOIN whatsapp_bridge_accounts a ON a.id = c.account_id
        WHERE a.workspace_id = ${actor.workspaceId} AND c.revoked_at IS NULL
          AND a.revoked_at IS NULL AND a.status IN ('connected', 'paused')
        ORDER BY c.remote_chat_id`;
  return yield* Schema.decodeUnknownEffect(Schema.Array(chatSchema))(
    rows.map((row) => ({
      handle: row.handle,
      kind: row.kind,
      remoteChatId: row.remote_chat_id,
    }))
  );
});

export const ingestWhatsAppEvent = Effect.fn("ingestWhatsAppEvent")(function* (
  raw: typeof IngestWhatsAppEventSchema.Type
) {
  const input = yield* decode(IngestWhatsAppEventSchema)(raw);
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const accounts = yield* sql<{
        id: string;
        status: string;
      }>`SELECT id, status FROM whatsapp_bridge_accounts
        WHERE id = ${input.accountId} AND revoked_at IS NULL FOR UPDATE`;
      const account = accounts[0];
      if (!account) return yield* new WorkspaceAccessDenied();
      const chats = yield* sql<{
        id: string;
      }>`SELECT id FROM whatsapp_bridge_chats
        WHERE account_id = ${account.id} AND remote_chat_id = ${input.remoteChatId}
          AND revoked_at IS NULL FOR UPDATE`;
      const chat = chats[0];
      if (!chat) return yield* new WorkspaceAccessDenied();
      const existing = yield* sql<{
        id: string;
      }>`SELECT id FROM whatsapp_bridge_events
        WHERE account_id = ${account.id} AND provider_event_id = ${input.providerEventId}`;
      if (existing[0])
        return { id: existing[0].id, duplicate: true, alert: false };
      const id = randomUUID();
      yield* sql`INSERT INTO whatsapp_bridge_events(
          id, account_id, chat_id, provider_event_id, kind, author_remote_id, body, occurred_at
        ) VALUES (
          ${id}, ${account.id}, ${chat.id}, ${input.providerEventId}, ${input.kind},
          ${input.authorRemoteId}, ${input.body}, clock_timestamp()
        )`;
      if (input.kind === "backfill")
        yield* sql`UPDATE whatsapp_bridge_chats SET last_backfill_at = clock_timestamp()
          WHERE id = ${chat.id}`;
      if (input.kind === "live")
        yield* sql`UPDATE whatsapp_bridge_chats SET last_live_at = clock_timestamp()
          WHERE id = ${chat.id}`;
      return {
        id,
        duplicate: false,
        alert: input.kind === "live" && account.status === "connected",
      };
    })
  );
});

export const readWhatsAppMessages = Effect.fn("readWhatsAppMessages")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof WhatsAppChatIdSchema.Type
  ) {
    const input = yield* decode(WhatsAppChatIdSchema)(raw);
    const chat = yield* requireVisibleChat(actor, input.chatId);
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql<{
      id: string;
      author_remote_id: string;
      body: string;
      kind: string;
    }>`SELECT id, author_remote_id, body, kind FROM whatsapp_bridge_events
      WHERE chat_id = ${chat.id} ORDER BY occurred_at, created_at`;
    return rows.map((row) => ({
      authorRemoteId: row.author_remote_id,
      body: row.body,
      id: row.id,
      kind: row.kind,
    }));
  }
);

export const summarizeWhatsAppChat = Effect.fn("summarizeWhatsAppChat")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof WhatsAppChatIdSchema.Type
  ) {
    const messages = yield* readWhatsAppMessages(actor, raw);
    return {
      coverage: messages.some((message) => message.kind === "live")
        ? ("complete" as const)
        : ("partial" as const),
      originIds: messages.map((message) => message.id),
      text: messages.map((message) => message.body).join("\n"),
    };
  }
);

export const shareWhatsAppChat = Effect.fn("shareWhatsAppChat")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof ShareWhatsAppChatSchema.Type
) {
  const input = yield* decode(ShareWhatsAppChatSchema)(raw);
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const chat = yield* requireOwnedChat(actor, input.chatId);
      if (chat.kind !== "group") return yield* new WorkspaceAccessDenied();
      const dest = yield* sql`SELECT w.id FROM workspaces w
          JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = ${actor.userId}
          JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = ${actor.userId}
          WHERE w.id = ${input.workspaceId} AND w.organization_id IS NOT NULL FOR SHARE OF w, m, o`;
      if (!dest.length) return yield* new WorkspaceAccessDenied();
      yield* sql`INSERT INTO whatsapp_bridge_shares(id, chat_id, workspace_id, issued_by)
        VALUES (${randomUUID()}, ${chat.id}, ${input.workspaceId}, ${actor.userId})
        ON CONFLICT (chat_id, workspace_id) WHERE revoked_at IS NULL DO NOTHING`.pipe(
        Effect.catch(() => Effect.void)
      );
      const live = yield* sql<{
        id: string;
      }>`SELECT id FROM whatsapp_bridge_shares
        WHERE chat_id = ${chat.id} AND workspace_id = ${input.workspaceId} AND revoked_at IS NULL`;
      if (!live[0]) return yield* new WorkspaceAccessDenied();
      return { id: live[0].id };
    })
  );
});

export const importWhatsAppContacts = Effect.fn("importWhatsAppContacts")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof ImportWhatsAppContactsSchema.Type
  ) {
    const input = yield* decode(ImportWhatsAppContactsSchema)(raw);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const account = yield* requireAccount(actor, true);
        for (const contact of input.contacts) {
          yield* sql`INSERT INTO whatsapp_bridge_contacts(id, account_id, remote_user_id, display_name)
            VALUES (${randomUUID()}, ${account.id}, ${contact.remoteUserId}, ${contact.name})
            ON CONFLICT (account_id, remote_user_id) DO UPDATE SET display_name = EXCLUDED.display_name`;
        }
        return { imported: input.contacts.length };
      })
    );
  }
);

export const draftWhatsAppMessage = Effect.fn("draftWhatsAppMessage")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof WhatsAppDraftSchema.Type
  ) {
    const input = yield* decode(WhatsAppDraftSchema)(raw);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const chat = yield* requireOwnedChat(actor, input.chatId);
        const id = randomUUID();
        yield* sql`INSERT INTO whatsapp_bridge_drafts(
            id, account_id, chat_id, body, status, issued_by
          ) VALUES (${id}, ${chat.accountId}, ${chat.id}, ${input.body}, 'draft', ${actor.userId})`;
        return { id };
      })
    );
  }
);

export const authorizeWhatsAppDraft = Effect.fn("authorizeWhatsAppDraft")(
  function* (actor: typeof WorkspaceActorSchema.Type, id: string) {
    const draftId = yield* decode(uuid)(id);
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* requirePersonalOwner(actor);
        const updated =
          yield* sql`UPDATE whatsapp_bridge_drafts d SET status = 'authorized',
            authorized_body = d.body, authorized_chat_id = d.chat_id
          FROM whatsapp_bridge_accounts a
          WHERE d.id = ${draftId} AND d.account_id = a.id AND a.workspace_id = ${actor.workspaceId}
            AND a.revoked_at IS NULL AND d.status IN ('draft', 'authorized')
            AND d.issued_by = ${actor.userId}
          RETURNING d.id`;
        if (!updated.length) return yield* new WorkspaceAccessDenied();
        return { authorized: true as const };
      })
    );
  }
);

export const sendWhatsAppDraft = Effect.fn("sendWhatsAppDraft")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  id: string
) {
  const draftId = yield* decode(uuid)(id);
  const sql = yield* PgClient.PgClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const account = yield* requireAccount(actor, true);
      if (account.status !== "connected")
        return yield* new WorkspaceAccessDenied();
      const updated =
        yield* sql`UPDATE whatsapp_bridge_drafts SET status = 'queued', queued_at = clock_timestamp()
          WHERE id = ${draftId} AND account_id = ${account.id} AND issued_by = ${actor.userId}
            AND status = 'authorized' AND authorized_body = body AND authorized_chat_id = chat_id
          RETURNING id`;
      if (!updated.length) return yield* new WorkspaceAccessDenied();
      return true;
    })
  );
  return yield* requireWhatsAppBridge();
});

export const pauseWhatsAppBridge = Effect.fn("pauseWhatsAppBridge")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  return yield* setAccountStatus(actor, "connected", "paused");
});

export const resumeWhatsAppBridge = Effect.fn("resumeWhatsAppBridge")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    return yield* setAccountStatus(actor, "paused", "connected");
  }
);

export const revokeWhatsAppBridge = Effect.fn("revokeWhatsAppBridge")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const account = yield* requireAccount(actor, true);
        yield* sql`UPDATE whatsapp_bridge_drafts SET status = 'cancelled'
          WHERE account_id = ${account.id} AND status IN ('draft', 'authorized', 'queued')`;
        yield* sql`UPDATE whatsapp_bridge_shares SET revoked_at = clock_timestamp()
          WHERE revoked_at IS NULL AND chat_id IN (
            SELECT id FROM whatsapp_bridge_chats WHERE account_id = ${account.id}
          )`;
        yield* sql`UPDATE whatsapp_bridge_chats SET revoked_at = clock_timestamp()
          WHERE account_id = ${account.id} AND revoked_at IS NULL`;
        yield* sql`UPDATE whatsapp_bridge_accounts
          SET status = 'revoked', revoked_at = clock_timestamp(), pairing_nonce_hash = 'revoked'
          WHERE id = ${account.id}`;
        return { revoked: true as const };
      })
    );
  }
);

const requirePersonalOwner = Effect.fn("requireWhatsAppPersonalOwner")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const access = yield* requireWorkspaceAccess(actor, true);
    if (access.organizationId) return yield* new WorkspaceAccessDenied();
    return { ...access, userId: actor.userId };
  }
);

const requireAccount = Effect.fn("requireWhatsAppAccount")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  manage: boolean
) {
  if (manage) yield* requirePersonalOwner(actor);
  else yield* requireWorkspaceAccess(actor);
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{
    id: string;
    status: string;
  }>`SELECT id, status FROM whatsapp_bridge_accounts
    WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL
      AND status IN ('connected', 'paused') FOR UPDATE`;
  const account = rows[0];
  if (!account) return yield* new WorkspaceAccessDenied();
  return account;
});

const requireOwnedChat = Effect.fn("requireWhatsAppOwnedChat")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  chatId: string
) {
  const account = yield* requireAccount(actor, true);
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{
    id: string;
    account_id: string;
    kind: string;
  }>`SELECT id, account_id, kind FROM whatsapp_bridge_chats
    WHERE id = ${chatId} AND account_id = ${account.id} AND revoked_at IS NULL`;
  const chat = rows[0];
  if (!chat) return yield* new WorkspaceAccessDenied();
  return { accountId: chat.account_id, id: chat.id, kind: chat.kind };
});

const requireVisibleChat = Effect.fn("requireWhatsAppVisibleChat")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  chatId: string
) {
  const chats = yield* listWhatsAppChats(actor);
  const chat = chats.find((item) => item.handle === chatId);
  if (!chat) return yield* new WorkspaceAccessDenied();
  return { id: chat.handle };
});

const setAccountStatus = Effect.fn("setWhatsAppAccountStatus")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  from: "connected" | "paused",
  to: "connected" | "paused"
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const account = yield* requireAccount(actor, true);
      if (account.status !== from) return yield* new WorkspaceAccessDenied();
      const updated =
        to === "paused"
          ? yield* sql`UPDATE whatsapp_bridge_accounts
              SET status = 'paused', paused_at = clock_timestamp()
              WHERE id = ${account.id} AND status = 'connected' RETURNING id`
          : yield* sql`UPDATE whatsapp_bridge_accounts
              SET status = 'connected', paused_at = NULL
              WHERE id = ${account.id} AND status = 'paused' RETURNING id`;
      if (!updated.length) return yield* new WorkspaceAccessDenied();
      return { status: to };
    })
  );
});

function hashNonce(nonce: string) {
  return createHash("sha256").update(nonce).digest("hex");
}

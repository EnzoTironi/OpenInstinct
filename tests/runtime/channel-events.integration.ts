/* eslint-disable typescript/no-unsafe-type-assertion -- Synthetic callback data supplies only fields consumed by these handlers; all services remain real. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { Config, Effect } from "effect";
import type { ChannelEvents } from "eve/channels";
import { test } from "vitest";

import { privateChannelEvents } from "../../agent/lib/private-channel-events";
import { ChannelAccounts } from "../../server/accounts";
import { channelPrincipal } from "../../server/channels/principal";
import { serverRuntime } from "../../server/runtime";
import { accessScopeForUser } from "../../shared/identity/access-scope";

type AuthPrincipal = ReturnType<typeof channelPrincipal>;

type FailedChannel = Parameters<NonNullable<ChannelEvents["turn.failed"]>>[1];

type FailedContext = Parameters<NonNullable<ChannelEvents["turn.failed"]>>[2];

type AuthzChannel = Parameters<
  NonNullable<ChannelEvents["authorization.required"]>
>[1];

type AuthzContext = Parameters<
  NonNullable<ChannelEvents["authorization.required"]>
>[2];

const assertCompanionRuntimeDatabase = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;

  const rows = yield* sql<{
    name: string;
  }>`SELECT current_database() AS name`;

  assert.equal(rows[0]?.name, "companion_runtime_test");
});

const resolveTelegramSender = (senderId: string) =>
  Effect.gen(function* () {
    const accounts = yield* ChannelAccounts;

    return yield* accounts.resolveVerifiedSender({
      channel: "telegram",
      installationId: randomUUID(),
      senderId,
    });
  });

const revokeChannelIdentity = (identityId: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
  });

const deleteMembership = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql`DELETE FROM workspace_memberships WHERE user_id = ${accessScopeForUser(`better-auth:${userId}`).userId}`;
  });

const cleanupTelegramUser = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${userId}`).workspaceId}`;
    yield* sql`DELETE FROM public."user" WHERE id = ${userId}`;
  });

const makeFailedContext =
  (sessionId: string, auth: AuthPrincipal) =>
  (
    current: AuthPrincipal | null,
    initiator: AuthPrincipal | null = auth
  ): FailedContext =>
    // SAFETY: handlers read only session ID and auth; this fixture supplies both.
    ({
      session: { id: sessionId, auth: { current, initiator } },
    }) as FailedContext;

const makeAuthzContext =
  (sessionId: string, auth: AuthPrincipal) =>
  (
    current: AuthPrincipal | null,
    initiator: AuthPrincipal | null = auth
  ): AuthzContext =>
    // SAFETY: the actual handler reads only session.id and auth from this synthetic context.
    ({
      session: { id: sessionId, auth: { current, initiator } },
    }) as AuthzContext;

const fireFailedSequences = (
  handlers: ReturnType<typeof privateChannelEvents>,
  failure: {
    readonly turnId: string;
    readonly sequence: number;
    readonly code: string;
    readonly message: string;
    readonly details: { readonly token: string };
  },
  channel: FailedChannel,
  context: FailedContext
) =>
  Promise.all(
    Array.from({ length: 8 }, (_, sequence) =>
      handlers["turn.failed"]({ ...failure, sequence }, channel, context)
    )
  );

const rejectInvalidFailedPrincipals = (
  handlers: ReturnType<typeof privateChannelEvents>,
  failure: {
    readonly turnId: string;
    readonly sequence: number;
    readonly code: string;
    readonly message: string;
    readonly details: { readonly token: string };
  },
  channel: FailedChannel,
  context: ReturnType<typeof makeFailedContext>,
  invalid: readonly AuthPrincipal[]
) =>
  Promise.all(
    invalid.map((principal) =>
      assert.rejects(async () =>
        handlers["turn.failed"](
          { ...failure, turnId: randomUUID() },
          channel,
          context(principal)
        )
      )
    )
  );

const expectedTurnStatusRows = (
  sessionId: string,
  turnIds: readonly string[]
) =>
  turnIds
    .map((turnId) => ({
      delivery_key: `turn-status:${sessionId}:${turnId}:0`,
      payload: {
        text: "This turn ended before completion.",
        attachments: [],
      },
      status: "queued",
    }))
    .toSorted((a, b) => a.delivery_key.localeCompare(b.delivery_key));

const assertTurnStatusOutbox = (
  identityId: string,
  sessionId: string,
  turnIds: readonly string[]
) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;

    const rows = yield* sql<{
      delivery_key: string;
      payload: { text: string };
      status: string;
    }>`
        SELECT delivery_key, payload, status FROM channel_outbox WHERE identity_id = ${identityId}
        ORDER BY delivery_key`;

    assert.deepEqual(rows, expectedTurnStatusRows(sessionId, turnIds));
  });

const fireAuthorizationSequences = (
  handlers: ReturnType<typeof privateChannelEvents>,
  event: {
    readonly attemptId: string;
    readonly turnId: string;
    readonly stepIndex: number;
    readonly sequence: number;
    readonly name: string;
    readonly description: string;
    readonly authorization: {
      readonly displayName: string;
      readonly url: string;
      readonly instructions: string;
      readonly userCode: string;
    };
    readonly webhookUrl: string;
  },
  channel: AuthzChannel,
  context: AuthzContext
) =>
  Promise.all(
    Array.from({ length: 8 }, (_, sequence) =>
      handlers["authorization.required"](
        { ...event, sequence },
        channel,
        context
      )
    )
  );

const assertAuthorizationOutbox = (identityId: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;

    const rows = yield* sql<{
      payload: { text: string };
      status: string;
    }>`SELECT payload, status FROM channel_outbox WHERE identity_id = ${identityId}`;

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "queued");
    assert.equal(
      rows[0].payload.text,
      "Connect Google Workspace\n\nConnect to create the event.\n\nUse your linked account.\n\nCode: TEST-CODE\n\nhttps://example.com/authorize"
    );
  });

const assertSingleOutboxRow = (identityId: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;

    const rows =
      yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`;

    assert.equal(rows.length, 1);
  });

test("terminal channel events persist once per turn and enforce current authority", async () => {
  const url = await Effect.runPromise(Config.string("DATABASE_URL"));
  assert.equal(new URL(url).pathname, "/companion_runtime_test");
  await serverRuntime.runPromise(assertCompanionRuntimeDatabase);

  const identity = await serverRuntime.runPromise(
    resolveTelegramSender("928374")
  );

  try {
    const handlers = privateChannelEvents("telegram");
    const auth = channelPrincipal(identity);
    const sessionId = randomUUID();
    const context = makeFailedContext(sessionId, auth);

    // SAFETY: all three handlers ignore their channel argument.
    const channel = undefined as FailedChannel;

    const failure = {
      turnId: randomUUID(),
      sequence: 1,
      code: "MODEL_CALL_FAILED",
      message: "synthetic-provider-secret",
      details: { token: "synthetic-private-detail" },
    };

    await fireFailedSequences(handlers, failure, channel, context(auth));
    await handlers["turn.cancelled"](
      { turnId: failure.turnId, sequence: 99 },
      channel,
      context(auth)
    );
    const cancelledTurn = randomUUID();
    await handlers["turn.cancelled"](
      { turnId: cancelledTurn, sequence: 100 },
      channel,
      context(null)
    );

    const invalid = [
      { ...auth, principalId: `better-auth:${randomUUID()}` },
      {
        ...auth,
        attributes: { ...auth.attributes, workspaceId: "wrong-workspace" },
      },
      {
        ...auth,
        attributes: { ...auth.attributes, conversationId: randomUUID() },
      },
    ];

    await rejectInvalidFailedPrincipals(
      handlers,
      failure,
      channel,
      context,
      invalid
    );
    await assert.rejects(async () =>
      handlers["turn.failed"](
        { ...failure, turnId: randomUUID() },
        channel,
        context(null, null)
      )
    );
    await serverRuntime.runPromise(revokeChannelIdentity(identity.id));
    await assert.rejects(async () =>
      handlers["turn.cancelled"](
        { turnId: randomUUID(), sequence: 101 },
        channel,
        context(auth)
      )
    );
    await serverRuntime.runPromise(
      assertTurnStatusOutbox(identity.id, sessionId, [
        failure.turnId,
        cancelledTurn,
      ])
    );
  } finally {
    await serverRuntime.runPromise(cleanupTelegramUser(identity.userId));
  }
});

test("authorization challenges persist exact public fields once and reject stale identity", async () => {
  const url = await Effect.runPromise(Config.string("DATABASE_URL"));
  assert.equal(new URL(url).pathname, "/companion_runtime_test");

  const identity = await serverRuntime.runPromise(
    resolveTelegramSender("928375")
  );

  try {
    const handlers = privateChannelEvents("telegram");
    const auth = channelPrincipal(identity);
    const sessionId = randomUUID();
    const callbackContext = makeAuthzContext(sessionId, auth);
    const context = callbackContext(auth);

    // SAFETY: the handler does not read the channel argument.
    const channel = undefined as AuthzChannel;

    const event = {
      attemptId: randomUUID(),
      turnId: randomUUID(),
      stepIndex: 0,
      sequence: 1,
      name: "google-workspace",
      description: "Connect to create the event.",
      authorization: {
        displayName: "Google Workspace",
        url: "https://example.com/authorize",
        instructions: "Use your linked account.",
        userCode: "TEST-CODE",
      },
      webhookUrl: "https://internal.example.com/private-callback-token",
    };

    await fireAuthorizationSequences(handlers, event, channel, context);
    await serverRuntime.runPromise(assertAuthorizationOutbox(identity.id));
    await assert.rejects(() =>
      handlers["authorization.required"](
        { ...event, description: "Changed replay" },
        channel,
        context
      )
    );

    const wrongOwner = {
      ...context,
      session: {
        ...context.session,
        auth: {
          current: { ...auth, principalId: `better-auth:${randomUUID()}` },
          initiator: auth,
        },
      },
    };

    await assert.rejects(() =>
      handlers["authorization.required"](
        { ...event, attemptId: randomUUID() },
        channel,
        wrongOwner
      )
    );
    await serverRuntime.runPromise(deleteMembership(identity.userId));
    await assert.rejects(() =>
      handlers["authorization.required"](
        { ...event, attemptId: randomUUID() },
        channel,
        context
      )
    );
    await serverRuntime.runPromise(assertSingleOutboxRow(identity.id));
  } finally {
    await serverRuntime.runPromise(cleanupTelegramUser(identity.userId));
  }
});

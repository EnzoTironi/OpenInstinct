import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import {
  Clock,
  ConfigProvider,
  Effect,
  Layer,
  Predicate,
  Result,
} from "effect";
import type { HookContext } from "eve/hooks";
import { expect, test } from "vitest";

import completionHook from "../../agent/hooks/scheduled-run-completion";
import {
  claimScheduledReport,
  getScheduledReportChannel,
} from "../../db/services/scheduled-agent-jobs";
import { ChannelAccounts } from "../../server/accounts";
import { Kapso } from "../../server/channels/kapso";
import { Telegram } from "../../server/channels/telegram";
import { ChannelTransport } from "../../server/channels/transport";
import { Messaging } from "../../server/messaging";
import { requireScheduledChannelOwner } from "../../server/schedules/channel-owner";
import {
  dispatchNativeScheduledReport,
  deliverNativeScheduledReport,
} from "../../server/schedules/native-report";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const dependencies = Layer.mergeAll(
  ChannelAccounts.layer,
  Messaging.layer,
  Telegram.layer,
  Kapso.layer
).pipe(Layer.provideMerge(runtimeDatabase));

const services = ChannelTransport.layer.pipe(Layer.provideMerge(dependencies));

const fixture = Effect.fn("nativeReports.fixture")(function* (
  body: (fixture: {
    runId: string;
    jobId: string;
    identityId: string;
    userId: string;
    workspaceId: string;
  }) => Effect.Effect<
    void,
    unknown,
    PgClient.PgClient | ChannelTransport | Messaging
  >,
  channel: "telegram" | "kapso" = "telegram"
) {
  const sql = yield* PgClient.PgClient;
  const userId = randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);

  const identityId = randomUUID(),
    jobId = randomUUID(),
    runId = randomUUID();

  yield* Effect.acquireRelease(
    Effect.gen(function* () {
      yield* sql`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'Schedule proof', ${`${userId}@example.invalid`})`;
      yield* sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId})`;
    }),
    () =>
      Effect.gen(function* () {
        yield* sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`;
        yield* sql`DELETE FROM "user" WHERE id = ${userId}`;
      }).pipe(Effect.catch((error) => Effect.die(error)))
  );
  yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${scope.workspaceId}, ${scope.userId}, 'owner')`;
  yield* sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
    VALUES (${identityId}, ${channel}, 'schedule-proof', ${identityId}, ${userId})`;
  yield* sql`INSERT INTO scheduled_agent_jobs
    (id, workspace_id, created_by_user_id, conversation_channel, conversation_id, prompt, timing, status)
    VALUES (${jobId}, ${scope.workspaceId}, ${scope.userId}, ${channel}, ${identityId}, 'Report task',
    '{"kind":"once","at":"2030-01-01T00:00:00Z"}'::jsonb, 'completed')`;
  yield* sql`INSERT INTO scheduled_agent_runs (id, job_id, scheduled_for, status, report_status, outcome)
    VALUES (${runId}, ${jobId}, clock_timestamp(), 'completed', 'pending',
      ${sql.json({ kind: "result", summary: "s".repeat(4000), details: "d".repeat(5000), urgency: "normal" })})`;
  yield* body({
    runId,
    jobId,
    identityId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  });
});

const run = (
  body: Parameters<typeof fixture>[0],
  channel?: "telegram" | "kapso"
) =>
  Effect.runPromise(
    fixture(body, channel).pipe(Effect.scoped, Effect.provide(services))
  );

test.each(["telegram", "kapso"] as const)(
  "%s recovery keeps exact output IDs despite changed stored outcome",
  (channel) =>
    run(
      Effect.fn("scheduled.case1")(function* ({ runId, identityId }) {
          const sql = yield* PgClient.PgClient;
          yield* Effect.all(
            [
              dispatchNativeScheduledReport(runId),
              dispatchNativeScheduledReport(runId),
            ],
            { concurrency: 2 }
          );

          const first =
            yield* sql`SELECT b.chunk_index, b.outbox_id FROM scheduled_agent_report_outputs b
      WHERE run_id = ${runId} ORDER BY chunk_index`;

          expect(first).toHaveLength(3);
          yield* sql`UPDATE scheduled_agent_runs SET outcome = '{}'::jsonb WHERE id = ${runId}`;
          yield* dispatchNativeScheduledReport(runId);
          expect(
            yield* sql`SELECT b.chunk_index, b.outbox_id FROM scheduled_agent_report_outputs b
      WHERE run_id = ${runId} ORDER BY chunk_index`
          ).toEqual(first);
          expect(
            yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
          ).toHaveLength(3);
        }),
      channel
    )
);

test("outer PostgreSQL rollback removes both output chunks and their bindings", () =>
  run(Effect.fn("run.1")(function* ({ runId, identityId }) {
      const sql = yield* PgClient.PgClient;
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* dispatchNativeScheduledReport(runId);

            return yield* Effect.fail(new Error("interrupt before commit"));
          })
        )
        .pipe(Effect.flip);
      expect(
        yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
      ).toHaveLength(0);
      expect(
        yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
      ).toHaveLength(0);
      yield* dispatchNativeScheduledReport(runId);
      expect(
        yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
      ).toHaveLength(3);
    })
  ));

test.each(["membership", "identity"] as const)(
  "revoked %s prevents waiting-input delivery",
  (revoke) =>
    run(Effect.fn("run.2")(function* ({ runId, identityId, workspaceId, userId }) {
        const sql = yield* PgClient.PgClient;
        yield* sql`UPDATE scheduled_agent_runs SET status = 'waiting_for_input' WHERE id = ${runId}`;

        if (revoke === "membership")
          yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`;
        else
          yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
        yield* dispatchNativeScheduledReport(runId);

        const remaining = yield* sql<{
          status: string;
        }>`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`;

        if (revoke === "membership") expect(remaining).toHaveLength(0);
        else expect(remaining[0]?.status).toBe("cancelled");
        expect(
          yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
        ).toHaveLength(0);
      })
    )
);

test("identity owner and current membership are independently required", () =>
  run(Effect.fn("run.3")(function* ({ identityId, workspaceId, userId }) {
      yield* requireScheduledChannelOwner({
        conversationChannel: "telegram",
        conversationId: identityId,
        createdByUserId: userId,
        workspaceId,
      });
      expect(
        yield* requireScheduledChannelOwner({
          conversationChannel: "telegram",
          conversationId: identityId,
          createdByUserId: "another-user",
          workspaceId,
        }).pipe(Effect.flip)
      ).toSatisfy((value) =>
        Predicate.isTagged(value, "ScheduleOwnerInactive")
      );
      expect(
        yield* requireScheduledChannelOwner({
          conversationChannel: "telegram",
          conversationId: identityId,
          createdByUserId: userId,
          workspaceId: "another-workspace",
        }).pipe(Effect.flip)
      ).toSatisfy((value) =>
        Predicate.isTagged(value, "ScheduleOwnerInactive")
      );
    })
  ));

test("uncertain output blocks recovery and is never enqueued again", () =>
  run(Effect.fn("run.4")(function* ({ runId, identityId }) {
      const sql = yield* PgClient.PgClient;
      const messaging = yield* Messaging;
      yield* dispatchNativeScheduledReport(runId);

      const claim = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!claim)
        return yield* Effect.fail(new Error("Expected durable output claim"));
      yield* messaging.markOutboxUncertain({
        lease: { identityId, id: claim.id, leaseToken: claim.leaseToken },
        reason: "handoff_unknown",
      });
      yield* dispatchNativeScheduledReport(runId);
      yield* dispatchNativeScheduledReport(runId);
      expect(
        (yield* sql<{
          status: string;
        }>`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`)[0]
          ?.status
      ).toBe("uncertain");
      expect(
        yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
      ).toHaveLength(3);
    })
  ));

test("revocation cancels queued chunks and preserves their durable bindings", () =>
  run(Effect.fn("run.5")(function* ({ runId, identityId }) {
      const sql = yield* PgClient.PgClient;
      const messaging = yield* Messaging;
      yield* dispatchNativeScheduledReport(runId);

      const before =
        yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId} ORDER BY chunk_index`;

      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
      expect(
        yield* messaging.claimOutbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      yield* dispatchNativeScheduledReport(runId);
      expect(
        (yield* sql<{
          status: string;
        }>`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`)[0]
          ?.status
      ).toBe("cancelled");
      expect(
        yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId} ORDER BY chunk_index`
      ).toEqual(before);
      expect(
        (yield* sql<{
          status: string;
        }>`SELECT status FROM channel_outbox WHERE identity_id = ${identityId}`).map(
          (row) => row.status
        )
      ).toEqual(["cancelled", "cancelled", "cancelled"]);
    })
  ));

test("membership deletion after enqueue denies transport before configuration or provider I/O", () =>
  run(Effect.fn("run.6")(function* ({ runId, identityId, workspaceId, userId }) {
      const sql = yield* PgClient.PgClient;
      const transport = yield* ChannelTransport;
      yield* dispatchNativeScheduledReport(runId);

      const before = yield* sql<{
        id: string;
      }>`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`;

      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`;
      expect(
        yield* transport
          .activeIdentity(identityId, "telegram")
          .pipe(Effect.flip)
      ).toMatchObject({ reason: "identity_inactive" });

      for (const output of before) {
        expect(
          yield* transport
            .drainOutbox(identityId)
            .pipe(
              Effect.provideService(
                ConfigProvider.ConfigProvider,
                ConfigProvider.fromUnknown({})
              ),
              Effect.flip
            )
        ).toMatchObject({ reason: "identity_inactive" });
        expect(
          (yield* sql<{
            status: string;
          }>`SELECT status FROM channel_outbox WHERE id = ${output.id}`)[0]
            ?.status
        ).toBe("failed");
      }

      expect(
        yield* sql`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`
      ).toEqual(before);

      const statuses = yield* sql<{
        status: string;
      }>`SELECT status FROM channel_outbox WHERE identity_id = ${identityId}`;

      expect(
        statuses.every(
          (row) => row.status === "failed" || row.status === "cancelled"
        )
      ).toBe(true);
    })
  ));

test.each(["last", "all"] as const)(
  "missing %s bindings block recovery without regenerating existing chunks",
  (missing) =>
    run(Effect.fn("run.7")(function* ({ runId, identityId }) {
        const sql = yield* PgClient.PgClient;
        yield* dispatchNativeScheduledReport(runId);

        const before =
          yield* sql`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`;

        if (missing === "all")
          yield* sql`DELETE FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`;
        else
          yield* sql`DELETE FROM scheduled_agent_report_outputs WHERE run_id = ${runId} AND chunk_index = 2`;
        yield* sql`UPDATE scheduled_agent_runs SET outcome = '{}'::jsonb WHERE id = ${runId}`;
        yield* dispatchNativeScheduledReport(runId);
        expect(
          (yield* sql<{
            status: string;
          }>`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`)[0]
            ?.status
        ).toBe("uncertain");
        expect(
          yield* sql`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`
        ).toEqual(before);
        expect(
          yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
        ).toHaveLength(missing === "all" ? 0 : 2);
      })
    )
);

test.each(["telegram", "kapso"] as const)(
  "legacy report claim leaves %s pending until atomic native enqueue",
  (channel) =>
    run(
      Effect.fn("scheduled.case2")(function* ({ runId }) {
          const sql = yield* PgClient.PgClient;
          expect(
            yield* Effect.tryPromise({
              try: () => getScheduledReportChannel(runId),
              catch: (c) => (c instanceof Error ? c : new Error(String(c))),
            })
          ).toBe(channel);
          expect(
            yield* Effect.tryPromise({
              try: () => claimScheduledReport(runId),
              catch: (c) => (c instanceof Error ? c : new Error(String(c))),
            })
          ).toBeUndefined();
          expect(
            (yield* sql<{
              status: string;
              lease: string | null;
            }>`SELECT report_status AS status, report_lease_token AS lease
      FROM scheduled_agent_runs WHERE id = ${runId}`)[0]
          ).toEqual({ status: "pending", lease: null });
          expect(
            yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
          ).toHaveLength(0);
          yield* dispatchNativeScheduledReport(runId);
          expect(
            (yield* sql<{
              status: string;
            }>`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`)[0]
              ?.status
          ).toBe("queued");
          expect(
            yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
          ).toHaveLength(3);
        }),
      channel
    )
);

test.each(["telegram", "kapso"] as const)(
  "%s report delivery attempts the durable outbox immediately and reconciles rejection",
  (channel) =>
    run(
      Effect.fn("scheduled.case3")(function* ({ runId, identityId }) {
          const sql = yield* PgClient.PgClient;
          yield* sql`UPDATE scheduled_agent_runs SET outcome = ${sql.json({ kind: "result", summary: "Lembrete: revisar a demonstração do Companion.", urgency: "normal" })} WHERE id = ${runId}`;

          // Actual provider adapter configuration is absent: it must reject before HTTP,
          // after the outbox transaction commits. No response or service is fabricated.
          const delivery = yield* deliverNativeScheduledReport(runId).pipe(
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromUnknown({})
            ),
            Effect.result
          );

          expect(Result.isFailure(delivery)).toBe(true);
          expect(
            yield* sql`SELECT status, attempts, payload->>'text' AS text, provider_message_id
      FROM channel_outbox WHERE identity_id = ${identityId}`
          ).toEqual([
            {
              status: "failed",
              attempts: 1,
              text: "Lembrete: revisar a demonstração do Companion.",
              provider_message_id: null,
            },
          ]);
          expect(
            yield* sql`SELECT report_status FROM scheduled_agent_runs WHERE id = ${runId}`
          ).toEqual([{ report_status: "failed" }]);
          expect(
            yield* sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
          ).toHaveLength(1);
          yield* deliverNativeScheduledReport(runId);
          expect(
            yield* sql`SELECT status, attempts FROM channel_outbox WHERE identity_id = ${identityId}`
          ).toEqual([{ status: "failed", attempts: 1 }]);
        }),
      channel
    )
);

test("native completion hook persists and attempts the report before returning", () =>
  run(Effect.fn("run.8")(function* ({ runId, identityId, userId, workspaceId }) {
      const sql = yield* PgClient.PgClient;
      const leaseToken = randomUUID();
      const sessionId = randomUUID();
      yield* sql`UPDATE scheduled_agent_runs SET status = 'running', report_status = 'not_ready', outcome = NULL,
      lease_token = ${leaseToken}, lease_expires_at = clock_timestamp() + interval '1 minute', worker_session_id = ${sessionId}
      WHERE id = ${runId}`;

      // SAFETY: the hook reads only this synthetic event's session identity, turn and auth; all services are real.
      const context = (
        initiator: HookContext["session"]["auth"]["initiator"]
      ) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Synthetic callback data supplies only the hook's consumed fields; database and transport are real.
        ({
          session: {
            id: sessionId,
            turn: { id: "turn-0", sequence: 0 },
            auth: { current: null, initiator },
          },
        }) as HookContext;

      const handler = completionHook.events?.["message.completed"];
      expect(handler).toBeDefined();

      if (!handler)
        return yield* Effect.fail(
          new Error("The completion hook is required.")
        );
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      yield* Effect.tryPromise({
        try: async () => {
          await handler(
            {
              type: "message.completed",
              data: {
                turnId: "turn-0",
                stepIndex: 0,
                sequence: 1,
                finishReason: "stop",
                message: "Lembrete: revisar a demonstração do Companion.",
              },
              meta: { id: randomUUID(), at },
            },
            context({
              authenticator: "scheduled-worker",
              principalId: userId,
              principalType: "user",
              attributes: {
                scheduledRunId: runId,
                scheduledRunLeaseToken: leaseToken,
                conversationChannel: "telegram",
                conversationId: identityId,
                channelIdentityId: identityId,
                workspaceId,
              },
            })
          );
        },
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      // The synthetic installation cannot match the configured real bot. The real
      // transport rejects before HTTP, proving this hook attempted the queued item.
      expect(
        yield* sql`SELECT status, report_status FROM scheduled_agent_runs WHERE id = ${runId}`
      ).toEqual([{ status: "completed", report_status: "failed" }]);
      expect(
        yield* sql`SELECT status, attempts, provider_message_id FROM channel_outbox WHERE identity_id = ${identityId}`
      ).toEqual([{ status: "failed", attempts: 1, provider_message_id: null }]);
    })
  ));

import { randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";
import {
  ingestClientTelemetry,
  pruneTelemetry,
  recordTelemetry,
  updateTelemetryPolicy,
} from "../../server/observability/events";
import {
  readDiagnosticSession,
  readInsights,
  reviewDiagnostic,
} from "../../server/observability/insights";

const { operators } = vi.hoisted(() => ({ operators: new Array<string>() }));
vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_BETA_FULL_TELEMETRY: true,
      ZOEN_OPERATOR_EMAILS: operators,
    },
  };
});
vi.mock("../../db/services/auth", async () => {
  const { Effect: Fx } = await import("effect");
  return {
    authentication: Fx.succeed({
      $context: Promise.resolve({
        secretConfig: "synthetic-observability-test-key",
      }),
    }),
  };
});
afterEach(() => {
  operators.length = 0;
  vi.restoreAllMocks();
});
const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);

test("diagnostics isolate members, redact secrets, encrypt content and deduplicate durable events", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { actor, guest, guestPersonal, sql } = yield* workspaceFixture();
        const sessionId = `diagnostic-${randomUUID()}`;
        const event = {
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          sessionId,
          kind: "step.completed",
          inputTokens: 12,
          outputTokens: 4,
          durationMs: 50,
          payload: {
            message: "synthetic useful context",
            accessToken: "must-not-persist",
          },
        };
        yield* recordTelemetry(event);
        yield* recordTelemetry(event);
        const raw =
          yield* sql`SELECT payload FROM telemetry_events WHERE id = ${event.id}`;
        expect(raw).toHaveLength(1);
        expect(JSON.stringify(raw)).not.toContain("synthetic useful context");
        const rows = yield* readDiagnosticSession(actor, sessionId);
        expect(rows.events[0]?.payload).toContain("synthetic useful context");
        expect(rows.events[0]?.payload).not.toContain("must-not-persist");
        expect(
          Result.isFailure(
            yield* readDiagnosticSession(guest, sessionId).pipe(Effect.result)
          )
        ).toBe(true);
        expect(
          Result.isFailure(
            yield* readDiagnosticSession(guestPersonal, sessionId).pipe(
              Effect.result
            )
          )
        ).toBe(true);
        expect((yield* readInsights(actor)).summary?.input_tokens).toBe(12);
        expect((yield* readInsights(guest)).summary?.input_tokens).toBe(0);
        yield* updateTelemetryPolicy(actor, false, 7);
        expect(
          (yield* readDiagnosticSession(actor, sessionId)).events[0]?.payload
        ).toBeNull();
      })
    ).pipe(Effect.provide(services))
  ));

test("platform access requires an allowlisted verified identity and produces audit receipts", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { actor, guestPersonal, sql } = yield* workspaceFixture();
        const sessionId = `diagnostic-${randomUUID()}`;
        yield* recordTelemetry({
          id: randomUUID(),
          workspaceId: guestPersonal.workspaceId,
          userId: guestPersonal.userId,
          sessionId,
          kind: "turn.failed",
          status: "failed",
          payload: { message: "synthetic failure" },
        });
        expect(
          Result.isFailure(
            yield* readDiagnosticSession(actor, sessionId, true).pipe(
              Effect.result
            )
          )
        ).toBe(true);
        operators.push("operator@example.invalid");
        yield* sql`UPDATE public.user SET email = 'operator@example.invalid', "emailVerified" = false WHERE ('better-auth:' || id) = ${actor.userId}`;
        expect(
          Result.isFailure(yield* readInsights(actor, true).pipe(Effect.result))
        ).toBe(true);
        yield* sql`UPDATE public.user SET "emailVerified" = true WHERE ('better-auth:' || id) = ${actor.userId}`;
        expect(
          (yield* readDiagnosticSession(actor, sessionId, true)).events[0]
            ?.payload
        ).toContain("synthetic failure");
        yield* reviewDiagnostic(actor, sessionId, "eval-candidate");
        const audit =
          yield* sql`SELECT kind FROM telemetry_events WHERE user_id = ${actor.userId} AND kind LIKE 'telemetry.operator.%'`;
        expect(audit).toHaveLength(2);
        yield* sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`;
        expect(
          Result.isFailure(yield* readInsights(actor, true).pipe(Effect.result))
        ).toBe(true);
      })
    ).pipe(Effect.provide(services))
  ));

test("client ingest cannot attach diagnostics to another member's agent session", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { actor, guest, sql } = yield* workspaceFixture();
        const sessionId = randomUUID();
        yield* sql`INSERT INTO agent_sessions(session_id, workspace_id, created_by_user_id) VALUES (${sessionId}, ${actor.workspaceId}, ${actor.userId})`;
        const batch = {
          batchId: randomUUID(),
          recordingId: randomUUID(),
          kind: "feedback" as const,
          sessionId,
          route: "/chat/:session",
          data: JSON.stringify({ rating: "down" }),
        };
        expect(
          Result.isFailure(
            yield* ingestClientTelemetry(guest, batch).pipe(Effect.result)
          )
        ).toBe(true);
        yield* ingestClientTelemetry(actor, batch);
        expect(
          (yield* readDiagnosticSession(actor, sessionId)).events
        ).toHaveLength(1);
      })
    ).pipe(Effect.provide(services))
  ));

test("retention erases old content while retaining metrics, then expires old metrics", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { actor, sql } = yield* workspaceFixture();
        const id = randomUUID();
        yield* recordTelemetry({
          id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          kind: "turn.completed",
          payload: { text: "expire this" },
        });
        yield* sql`UPDATE telemetry_events SET created_at = now() - interval '15 days' WHERE id = ${id}`;
        yield* pruneTelemetry();
        const retained =
          yield* sql`SELECT payload FROM telemetry_events WHERE id = ${id}`;
        expect(retained).toEqual([{ payload: null }]);
        yield* sql`UPDATE telemetry_events SET created_at = now() - interval '91 days' WHERE id = ${id}`;
        yield* pruneTelemetry();
        expect(
          yield* sql`SELECT id FROM telemetry_events WHERE id = ${id}`
        ).toHaveLength(0);
      })
    ).pipe(Effect.provide(services))
  ));

test("diagnostic pages bound payloads and continue without duplicates at identical timestamps", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { actor, sql } = yield* workspaceFixture();
        const sessionId = `diagnostic-${randomUUID()}`;
        const ids = Array.from({ length: 6 }, () => randomUUID()).toSorted();
        for (const id of ids)
          yield* recordTelemetry({
            id,
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            sessionId,
            kind: "replay",
            payload: {
              events: Array.from({ length: 10 }, () => "x".repeat(60000)),
            },
          });
        yield* sql`UPDATE telemetry_events SET created_at = '2026-09-14T00:00:00Z' WHERE session_id = ${sessionId}`;
        const first = yield* readDiagnosticSession(actor, sessionId);
        expect(first.events.length).toBeLessThan(ids.length);
        expect(
          new TextEncoder().encode(JSON.stringify(first)).length
        ).toBeLessThan(2000000);
        const received = first.events.map((event) => event.id);
        let cursor = first.nextCursor;
        for (let page = 0; cursor && page < 6; page++) {
          const next = yield* readDiagnosticSession(
            actor,
            sessionId,
            false,
            cursor
          );
          received.push(...next.events.map((event) => event.id));
          cursor = next.nextCursor;
        }
        expect(cursor).toBeNull();
        expect(received).toEqual(ids);
      })
    ).pipe(Effect.provide(services))
  ));

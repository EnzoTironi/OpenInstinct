import { randomUUID } from "node:crypto";
import { Effect, Layer, Result, Schema } from "effect";
import { expect, test } from "vitest";
import { scanSecretCanaries } from "../../server/qualification/canary";
import { toolsMissingEvidence } from "../../server/qualification/inventory";
import { discoverExecutor } from "../../server/executor/discovery";
import { executorContext } from "../../server/executor/dispatch";
import { requireVaultwarden } from "../../server/workspaces/vault";
import { requireWhatsAppBridge } from "../../server/workspaces/whatsapp";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { LearnedMemory } from "../../server/memory/learned";
import { recordTelemetry } from "../../server/observability/events";
import { readDiagnosticSession } from "../../server/observability/insights";
import { runtimeDatabase } from "./database";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";

const services = LearnedMemory.layer.pipe(
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);

const SearchPage = Schema.Struct({
  items: Schema.Array(Schema.Struct({ path: Schema.String })),
  nextOffset: Schema.NullOr(Schema.Number),
});

test("catalog discovery after skill publication is inventoried and live providers stay pending", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, guestPersonal, repository } =
        yield* workspaceFixture();
      const context = workspaceExecutionFor(actor);
      const discovered: string[] = [];
      let offset = 0;
      for (;;) {
        const page = yield* Schema.decodeUnknownEffect(SearchPage, {
          onExcessProperty: "ignore",
        })(
          yield* discoverExecutor(executorContext(context), "search", {
            kind: "tool",
            limit: 20,
            offset,
          })
        );
        discovered.push(...page.items.map((item) => item.path));
        if (page.nextOffset == null) break;
        offset = page.nextOffset;
      }
      expect(discovered.length).toBeGreaterThan(0);
      expect(toolsMissingEvidence(discovered)).toEqual([]);
      yield* repository.write(actor, {
        content: "# Qualification\n\nDo not treat this body as a live pass.",
        expectedRevision: null,
        operationId: randomUUID(),
        path: "skills/qualify.md",
      });
      const skills = yield* Schema.decodeUnknownEffect(SearchPage, {
        onExcessProperty: "ignore",
      })(
        yield* discoverExecutor(executorContext(context), "search", {
          kind: "skill",
          query: "qualify",
        })
      );
      expect(skills.items.map((item) => item.path)).toContain(
        "skills/qualify.md"
      );
      expect(
        Result.isFailure(yield* requireWhatsAppBridge().pipe(Effect.result))
      ).toBe(true);
      expect(
        Result.isFailure(yield* requireVaultwarden().pipe(Effect.result))
      ).toBe(true);
      const planted = `totp-canary-${randomUUID()}`;
      const sessionId = `qualify-${randomUUID()}`;
      yield* recordTelemetry({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        sessionId,
        kind: "step.completed",
        name: "execute",
        channel: "eve",
        model: "synthetic",
        durationMs: 12,
        payload: { totp: planted, message: "synthetic executor step" },
      });
      const diagnostic = yield* readDiagnosticSession(actor, sessionId);
      const serialized = JSON.stringify(diagnostic);
      expect(scanSecretCanaries(serialized, [planted])).toEqual([]);
      expect(serialized).not.toContain(planted);
      expect(diagnostic.events[0]).toMatchObject({
        kind: "step.completed",
        name: "execute",
        model: "synthetic",
        payload: null,
      });
      expect(
        Result.isFailure(
          yield* readDiagnosticSession(guestPersonal, sessionId).pipe(
            Effect.result
          )
        )
      ).toBe(true);
      expect(
        Result.isFailure(
          yield* readDiagnosticSession(guest, sessionId).pipe(Effect.result)
        )
      ).toBe(true);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

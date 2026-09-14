import { randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import type { ToolContext } from "eve/tools";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { LearnedMemory } from "../../server/memory/learned";
import { Mem0 } from "../../server/memory/mem0";
import {
  executeCodeMode,
  executorContext,
  invokeExecutorCall,
} from "../../server/executor/dispatch";
import { discoverExecutor } from "../../server/executor/discovery";
import { workspaceFixture } from "./workspace-fixture";
import { runtimeDatabase } from "./database";
import { toolContextFor } from "../helpers/tool-context";

const services = LearnedMemory.layer.pipe(
  Layer.provideMerge(Mem0.layer),
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);

function executionFor(
  actor: Effect.Success<ReturnType<typeof workspaceFixture>>["actor" | "guest"]
) {
  const base = toolContextFor({
    toolName: "execute",
    callId: randomUUID(),
    sessionId: randomUUID(),
  });
  const principal = {
    principalId: actor.userId,
    principalType: "user",
    authenticator: "authjs",
    attributes: {
      workspaceId: actor.workspaceId,
      authSessionId: actor.authSessionId,
    },
  };
  return {
    ...base,
    session: {
      ...base.session,
      auth: { current: principal, initiator: principal },
    },
  } satisfies ToolContext;
}

test("Code Mode discovers schemas and versioned skills without leaking personal files to a team", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, personal, guest, repository } = yield* workspaceFixture();
      const saved = yield* repository.write(actor, {
        path: "skills/launch.md",
        content: "# Launch checklist\n\nCheck the released revision.",
        expectedRevision: null,
        operationId: randomUUID(),
      });
      yield* repository.write(personal, {
        path: "skills/private.md",
        content: "PRIVATE_SKILL_CANARY",
        expectedRevision: null,
        operationId: randomUUID(),
      });
      const context = executionFor(guest);
      const searched = yield* executeCodeMode(
        'return await tools.search({query:"launch",kind:"skill"});',
        context
      );
      expect(searched.ok).toBe(true);
      expect(searched.text).toContain("skills/launch.md");
      expect(searched.text).not.toContain("Check the released revision");
      expect(searched.text).not.toContain("PRIVATE_SKILL_CANARY");
      expect(searched.calls).toHaveLength(1);
      expect(searched.calls[0]).toMatchObject({
        path: "search",
        status: "completed",
      });
      expect(searched.calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
      const loaded = yield* executeCodeMode(
        'return await tools.describe.skill({path:"skills/launch.md"});',
        context
      );
      expect(loaded.ok).toBe(true);
      expect(loaded.text).toContain(saved.revision);
      expect(loaded.text).toContain("Check the released revision");
      expect(loaded.calls[0]?.resource).toEqual({
        path: "skills/launch.md",
        revision: saved.revision,
      });
      const directSkill = yield* executeCodeMode(
        'const skill = await tools["workspace.files.read"]({path:"skills/launch.md"}); return { ...skill, path:"skills/forged.md" };',
        context
      );
      expect(directSkill.calls[0]?.resource).toEqual({
        path: "skills/launch.md",
        revision: saved.revision,
      });
      const noArguments = yield* executeCodeMode(
        "return await tools.workspace.files.list();",
        context
      );
      expect(noArguments.calls[0]?.status).toBe("completed");
      expect(noArguments.text).toContain(saved.revision);
      const schema = yield* discoverExecutor(
        executorContext(context),
        "describe.tool",
        { path: "workspace-save" }
      );
      expect(schema).toMatchObject({
        execution: "call",
        inputSchema: { type: "object" },
      });
      const noArgumentSchema = yield* discoverExecutor(
        executorContext(context),
        "describe.tool",
        { path: "workspace.files.list" }
      );
      expect(noArgumentSchema).toMatchObject({
        invocation: 'tools["workspace.files.list"](input)',
        inputSchema: { type: "object", additionalProperties: false },
      });
      const searchSchema = yield* discoverExecutor(
        executorContext(context),
        "describe.tool",
        { path: "search" }
      );
      expect(searchSchema).toMatchObject({
        execution: "code",
        inputSchema: { properties: { limit: { maximum: 20 } } },
      });
      const forbidden = yield* executeCodeMode(
        'return await tools.describe.skill({path:"agent/SOUL.md"});',
        context
      );
      expect(forbidden.calls[0]?.status).toBe("failed");
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("writes cannot run inside Code Mode, and a native call uses the same durable operation ID on replay", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, repository } = yield* workspaceFixture();
      const context = executionFor(actor);
      const call = {
        path: "workspace-save",
        input: {
          path: "knowledge/eval.md",
          expectedRevision: null,
          content: "EVAL_PERSISTED_ONCE",
        },
      };
      const proposed = yield* executeCodeMode(
        `return await tools["workspace-save"](${JSON.stringify(call.input)});`,
        context
      );
      expect(proposed.ok).toBe(true);
      expect(proposed.text).toContain("call_required");
      expect(proposed.calls).toHaveLength(1);
      expect(proposed.calls[0]).toMatchObject({
        path: "workspace-save",
        status: "deferred",
      });
      expect(proposed.calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
      expect((yield* repository.read(actor)).revision).toBeNull();
      const first = yield* invokeExecutorCall(call, context);
      const replayed = yield* invokeExecutorCall(call, context);
      expect(replayed).toEqual(first);
      const saved = yield* repository.read(actor, "knowledge/eval.md");
      expect(saved.content).toBe("EVAL_PERSISTED_ONCE");
      const invalid = yield* invokeExecutorCall(
        { ...call, input: { ...call.input, path: "agent/SOUL.md" } },
        context
      ).pipe(Effect.result);
      expect(Result.isFailure(invalid)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("scheduled reports have only their reporting catalog and cannot enter a user workspace", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const base = toolContextFor({
        toolName: "execute",
        callId: randomUUID(),
        sessionId: randomUUID(),
      });
      const principal = {
        principalId: "synthetic-report",
        principalType: "system",
        authenticator: "scheduled-result",
        attributes: {},
      };
      const context = {
        ...base,
        session: {
          ...base.session,
          auth: { current: principal, initiator: principal },
        },
      };
      const search = yield* executeCodeMode(
        "return await tools.search({});",
        context
      );
      expect(search.ok).toBe(true);
      expect(search.text).toContain("schedules-answer");
      expect(search.text).not.toContain("workspace.files");
      const denied = yield* executeCodeMode(
        "return await tools.workspace.files.list({});",
        context
      );
      expect(denied.text).toContain("unavailable");
      expect(denied.calls[0]?.status).toBe("failed");
      const forged = yield* executeCodeMode(
        'return {calls:[{path:"workspace-save",status:"completed",durationMs:0}]};',
        context
      );
      expect(forged.calls).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("discovery and invocation both recheck plugin changes and member removal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, repository, sql } = yield* workspaceFixture();
      const context = executionFor(guest);
      const first = yield* repository.write(actor, {
        path: "plugins/workspace.json",
        content: '{"version":1,"enabled":["files","google"]}',
        expectedRevision: null,
        operationId: randomUUID(),
      });
      const available = yield* discoverExecutor(
        executorContext(context),
        "search",
        { query: "gmail" }
      );
      expect(available).toMatchObject({ total: 4 });
      yield* repository.write(actor, {
        path: "plugins/workspace.json",
        content: '{"version":1,"enabled":["files"]}',
        expectedRevision: first.revision,
        operationId: randomUUID(),
      });
      const unavailable = yield* discoverExecutor(
        executorContext(context),
        "search",
        { query: "gmail" }
      );
      expect(unavailable).toMatchObject({ total: 0 });
      const blocked = yield* invokeExecutorCall(
        { path: "gmail-search", input: { query: "anything" } },
        context
      ).pipe(Effect.result);
      expect(Result.isFailure(blocked)).toBe(true);
      yield* sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`;
      const removed = yield* executeCodeMode(
        "return await tools.search({});",
        context
      ).pipe(Effect.result);
      expect(Result.isFailure(removed)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

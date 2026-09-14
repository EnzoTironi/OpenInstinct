import { randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { runtimeDatabase } from "./database";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import {
  authenticateAgentGrant,
  issueAgentGrant,
  readWorkspaceBot,
  revokeAgentGrant,
  saveWorkspaceBot,
  searchWorkspaceBots,
} from "../../server/workspaces/bots";
import { requireWorkspaceAccess } from "../../server/workspaces/access";
import {
  acceptProtocolTask,
  bindProtocolSession,
  cancelProtocolTask,
  awaitProtocolTask,
  finishProtocolTask,
  readProtocolTask,
} from "../../server/a2a/tasks";
import { listProtocolTasks } from "../../server/a2a/list";
import { readExecutorCatalog } from "../../server/executor/workspace";
import { readAgentCard } from "../../server/a2a/card";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
const profile = () => ({
  username: `b${randomUUID().replaceAll("-", "").slice(0, 20)}`,
  name: "Test Zoen",
  description: "Synthetic knowledge assistant",
  discoverable: false,
});
const grantInput = {
  label: "Test agent",
  capabilities: ["files"] as const,
  days: 1,
};
const denied = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isFailure(result)).toBe(true);
};

test("bot discovery is opt-in and grants never cross bot or workspace boundaries", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal } = yield* workspaceFixture();
      const bot = yield* saveWorkspaceBot(actor, profile());
      expect(yield* searchWorkspaceBots(actor, bot.username)).toEqual([]);
      denied(yield* readAgentCard(bot.username, null).pipe(Effect.result));
      denied(yield* saveWorkspaceBot(guest, profile()).pipe(Effect.result));
      denied(yield* issueAgentGrant(guest, grantInput).pipe(Effect.result));
      const grant = yield* issueAgentGrant(actor, grantInput);
      const authorized = yield* authenticateAgentGrant(
        `Bearer ${grant.token}`,
        bot.username
      );
      expect(authorized.actor.workspaceId).toBe(actor.workspaceId);
      const privateBot = yield* saveWorkspaceBot(personal, profile());
      denied(
        yield* authenticateAgentGrant(
          `Bearer ${grant.token}`,
          privateBot.username
        ).pipe(Effect.result)
      );
      denied(
        yield* requireWorkspaceAccess({
          ...authorized.actor,
          workspaceId: personal.workspaceId,
        }).pipe(Effect.result)
      );
      denied(
        yield* requireWorkspaceAccess({
          ...authorized.actor,
          authSessionId: actor.authSessionId,
        }).pipe(Effect.result)
      );
      yield* saveWorkspaceBot(actor, { ...bot, discoverable: true });
      expect(yield* searchWorkspaceBots(actor, bot.username)).toHaveLength(1);
      expect(yield* searchWorkspaceBots(guest, bot.username)).toHaveLength(1);
      expect(yield* searchWorkspaceBots(personal, bot.username)).toEqual([]);
      expect(
        (yield* readAgentCard(bot.username, null)).supportedInterfaces[0]
          ?.protocolVersion
      ).toBe("1.0");
      expect((yield* readWorkspaceBot(guest)).grants).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("concurrent delivery, cancellation before binding, and late completion keep one terminal task", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor } = yield* workspaceFixture();
      const bot = yield* saveWorkspaceBot(actor, profile());
      const grant = yield* issueAgentGrant(actor, grantInput);
      const { actor: external } = yield* authenticateAgentGrant(
        `Bearer ${grant.token}`,
        bot.username
      );
      const input = {
        message: {
          messageId: randomUUID(),
          role: "ROLE_USER" as const,
          parts: [{ text: "One task" }],
        },
      };
      const results = yield* Effect.forEach(
        Array.from({ length: 8 }),
        () => acceptProtocolTask(external, input),
        { concurrency: 8 }
      );
      expect(new Set(results.map((task) => task.id)).size).toBe(1);
      const first = results[0];
      if (!first) throw new Error("No accepted task");
      const id = first.id;
      yield* requireWorkspaceAccess({ ...external, protocolTaskId: id });
      yield* cancelProtocolTask(external, id);
      yield* bindProtocolSession(external, id, "late-native-session");
      yield* finishProtocolTask(
        external,
        id,
        "TASK_STATE_COMPLETED",
        "Late answer"
      );
      expect((yield* cancelProtocolTask(external, id)).state).toBe(
        "TASK_STATE_CANCELED"
      );
      expect((yield* awaitProtocolTask(external, id)).output).toBeNull();
      denied(
        yield* requireWorkspaceAccess({ ...external, protocolTaskId: id }).pipe(
          Effect.result
        )
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("A2A pages have stable cursors, exact totals, filters and grant isolation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor } = yield* workspaceFixture();
      const bot = yield* saveWorkspaceBot(actor, profile());
      const grant = yield* issueAgentGrant(actor, grantInput);
      const otherGrant = yield* issueAgentGrant(actor, grantInput);
      const { actor: external } = yield* authenticateAgentGrant(
        `Bearer ${grant.token}`,
        bot.username
      );
      const { actor: other } = yield* authenticateAgentGrant(
        `Bearer ${otherGrant.token}`,
        bot.username
      );
      for (let index = 0; index < 7; index++) {
        const task = yield* acceptProtocolTask(external, {
          message: {
            messageId: randomUUID(),
            role: "ROLE_USER",
            parts: [{ text: `Task ${String(index)}` }],
          },
        });
        yield* finishProtocolTask(
          external,
          task.id,
          "TASK_STATE_COMPLETED",
          "Answer"
        );
      }
      const first = yield* listProtocolTasks(external, { pageSize: 3 });
      const second = yield* listProtocolTasks(external, {
        pageSize: 3,
        pageToken: first.nextPageToken,
        includeArtifacts: true,
      });
      const last = yield* listProtocolTasks(external, {
        pageSize: 3,
        pageToken: second.nextPageToken,
      });
      expect(first.totalSize).toBe(7);
      expect(first.pageSize).toBe(3);
      expect(last.tasks).toHaveLength(1);
      expect(last.nextPageToken).toBe("");
      expect(
        new Set(
          [...first.tasks, ...second.tasks, ...last.tasks].map(
            (task) => task.id
          )
        ).size
      ).toBe(7);
      expect(JSON.stringify(first.tasks)).not.toContain('"artifacts"');
      expect(second.tasks[0]?.artifacts).toHaveLength(1);
      denied(
        yield* listProtocolTasks(other, {
          pageToken: first.nextPageToken,
        }).pipe(Effect.result)
      );
      denied(
        yield* listProtocolTasks(external, {
          pageToken: first.nextPageToken,
          status: "TASK_STATE_FAILED",
        }).pipe(Effect.result)
      );
      expect(
        (yield* listProtocolTasks(external, { status: "TASK_STATE_FAILED" }))
          .totalSize
      ).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("revocation, expiry and issuer removal deny every subsequent agent operation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, sql } = yield* workspaceFixture();
      const bot = yield* saveWorkspaceBot(actor, profile());
      const grant = yield* issueAgentGrant(actor, grantInput);
      const { actor: external } = yield* authenticateAgentGrant(
        `Bearer ${grant.token}`,
        bot.username
      );
      yield* revokeAgentGrant(actor, grant.id);
      denied(yield* readExecutorCatalog(external).pipe(Effect.result));
      denied(
        yield* authenticateAgentGrant(
          `Bearer ${grant.token}`,
          bot.username
        ).pipe(Effect.result)
      );
      const expiring = yield* issueAgentGrant(actor, grantInput);
      yield* sql`UPDATE workspace_agent_grants SET expires_at = now() - interval '1 second' WHERE id = ${expiring.id}`;
      denied(
        yield* authenticateAgentGrant(
          `Bearer ${expiring.token}`,
          bot.username
        ).pipe(Effect.result)
      );
      const removed = yield* issueAgentGrant(actor, grantInput);
      expect(removed.id).not.toBe(grant.id);
      yield* sql`DELETE FROM workspace_memberships WHERE user_id = ${actor.userId} AND workspace_id = ${actor.workspaceId}`;
      denied(
        yield* authenticateAgentGrant(
          `Bearer ${removed.token}`,
          bot.username
        ).pipe(Effect.result)
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("external agents only read shared current files and cannot export memory, history or write", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, personal, repository } = yield* workspaceFixture();
      const bot = yield* saveWorkspaceBot(personal, profile());
      const first = yield* repository.write(personal, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/shared.md",
        content: "Version one",
      });
      const second = yield* repository.write(personal, {
        operationId: randomUUID(),
        expectedRevision: first.revision,
        path: "agent/USER.md",
        content: "Private profile",
      });
      const grant = yield* issueAgentGrant(personal, grantInput);
      const { actor: external } = yield* authenticateAgentGrant(
        `Bearer ${grant.token}`,
        bot.username
      );
      expect((yield* repository.read(external)).files).toEqual([
        "knowledge/shared.md",
      ]);
      expect(
        (yield* repository.selection(external, ["agent/USER.md"])).documents
      ).toEqual([]);
      denied(
        yield* repository.read(external, "agent/USER.md").pipe(Effect.result)
      );
      denied(
        yield* repository
          .read(external, "knowledge/shared.md", first.revision)
          .pipe(Effect.result)
      );
      denied(
        yield* repository
          .history(external, "knowledge/shared.md")
          .pipe(Effect.result)
      );
      denied(yield* repository.export(external).pipe(Effect.result));
      denied(
        yield* repository
          .write(external, {
            operationId: randomUUID(),
            expectedRevision: second.revision,
            path: "knowledge/shared.md",
            content: "Injected edit",
          })
          .pipe(Effect.result)
      );
      denied(
        yield* repository
          .read({ ...external, workspaceId: actor.workspaceId })
          .pipe(Effect.result)
      );
      expect(
        (yield* readExecutorCatalog(external)).tools.map((tool) => tool.path)
      ).toEqual([
        "workspace.files.list",
        "workspace.files.read",
        "workspace.files.search",
      ]);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("A2A messages are idempotent and tasks and contexts are private to their grant", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor } = yield* workspaceFixture();
      const bot = yield* saveWorkspaceBot(actor, profile());
      const firstGrant = yield* issueAgentGrant(actor, grantInput);
      const secondGrant = yield* issueAgentGrant(actor, grantInput);
      const { actor: first } = yield* authenticateAgentGrant(
        `Bearer ${firstGrant.token}`,
        bot.username
      );
      const { actor: second } = yield* authenticateAgentGrant(
        `Bearer ${secondGrant.token}`,
        bot.username
      );
      const input = {
        message: {
          messageId: randomUUID(),
          role: "ROLE_USER" as const,
          parts: [{ text: "Read the shared plan" }],
        },
      };
      const task = yield* acceptProtocolTask(first, input);
      expect((yield* acceptProtocolTask(first, input)).id).toBe(task.id);
      denied(
        yield* acceptProtocolTask(first, {
          message: { ...input.message, parts: [{ text: "Changed replay" }] },
        }).pipe(Effect.result)
      );
      denied(yield* readProtocolTask(second, task.id).pipe(Effect.result));
      denied(
        yield* acceptProtocolTask(second, {
          message: { ...input.message, contextId: task.contextId },
        }).pipe(Effect.result)
      );
      expect((yield* listProtocolTasks(second)).tasks).toEqual([]);
      yield* finishProtocolTask(
        first,
        task.id,
        "TASK_STATE_COMPLETED",
        "Plan reviewed"
      );
      yield* finishProtocolTask(
        first,
        task.id,
        "TASK_STATE_FAILED",
        "Late stale event"
      );
      expect((yield* readProtocolTask(first, task.id)).output).toBe(
        "Plan reviewed"
      );
      yield* revokeAgentGrant(actor, firstGrant.id);
      denied(yield* readProtocolTask(first, task.id).pipe(Effect.result));
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

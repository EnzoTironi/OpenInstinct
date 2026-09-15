import { randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runtimeDatabase } from "./database";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import {
  executorContext,
  executeCodeMode,
} from "../../server/executor/dispatch";
import { resolveExecutorTools } from "../../server/executor/catalog";
import { LearnedMemory } from "../../server/memory/learned";
import { matrixReceiver } from "./matrix-fixture";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { saveWorkspaceBot } from "../../server/workspaces/bots";
import {
  invitePersonalTrust,
  answerPersonalTrust,
  blockPersonalTrust,
} from "../../server/workspaces/network";
import {
  openMatrixConversation,
  sendMatrixConversation,
  readMatrixConversation,
  closeMatrixConversation,
} from "../../server/matrix/conversations";
import {
  matrixProtocolTask,
  publishMatrixProtocolAnswer,
} from "../../server/matrix/network-delivery";
import {
  finishProtocolTask,
  cancelProtocolTask,
  readProtocolTask,
  bindProtocolSession,
} from "../../server/a2a/tasks";
import { retireMatrixRooms } from "../../server/matrix/retirement";
import { readMatrixResult } from "../../server/matrix/result";
import { telemetryScope } from "../../server/observability/principal";
import { matrixRequest } from "../../server/matrix/client";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { removeWorkspaceMember } from "../../server/workspaces/team";

const services = LearnedMemory.layer.pipe(
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);
let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});
const profile = (name: string) => ({
  name,
  username: `b${randomUUID().replaceAll("-", "").slice(0, 20)}`,
  description: "Public synthetic bot profile",
  discoverable: true,
});
const fixture = Effect.gen(function* () {
  const f = yield* workspaceFixture();
  const ana = `a${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const bruno = `b${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  yield* saveDirectoryProfile(f.personal, {
    username: ana,
    discoverable: true,
  });
  yield* saveDirectoryProfile(f.guestPersonal, {
    username: bruno,
    discoverable: true,
  });
  const invited = yield* invitePersonalTrust(f.personal, { username: bruno });
  yield* answerPersonalTrust(f.guestPersonal, { id: invited.id, accept: true });
  const anaBot = yield* saveWorkspaceBot(f.personal, profile("Ana Zoen"));
  const brunoBot = yield* saveWorkspaceBot(
    f.guestPersonal,
    profile("Bruno Zoen")
  );
  return { ...f, ana, bruno, anaBot, brunoBot };
});
const receivedTask = (id: string) =>
  Effect.gen(function* () {
    for (let n = 0; n < 150; n++) {
      const task = yield* matrixProtocolTask(id);
      if (task) return task;
      yield* Effect.sleep("100 millis");
    }
    throw new Error("Synapse did not produce a persisted A2A task");
  });

test(
  "real Synapse routes a trusted human to the target bot through one A2A task",
  { timeout: 60000 },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { personal, guestPersonal, brunoBot, sql } = yield* fixture;
        const execution = workspaceExecutionFor(personal);
        const deferred = yield* executeCodeMode(
          `return await tools["network-contact"](${JSON.stringify({ username: brunoBot.username, text: "This must not be sent from Code Mode" })});`,
          execution
        );
        expect(deferred.text).toContain("call_required");
        expect(
          yield* sql`SELECT id FROM matrix_agent_conversations WHERE workspace_id = ${personal.workspaceId}`
        ).toHaveLength(0);
        const room = yield* openMatrixConversation(personal, brunoBot.username);
        expect(
          (yield* openMatrixConversation(personal, brunoBot.username)).id
        ).toBe(room.id);
        expect(
          Result.isFailure(
            yield* readMatrixConversation(guestPersonal, room.id).pipe(
              Effect.result
            )
          )
        ).toBe(true);
        const input = {
          id: room.id,
          operationId: randomUUID(),
          text: "Olá, Bruno.",
        };
        const event = yield* sendMatrixConversation(personal, input);
        expect(yield* sendMatrixConversation(personal, input)).toEqual(event);
        expect(
          Result.isFailure(
            yield* sendMatrixConversation(personal, {
              ...input,
              text: "Changed payload",
            }).pipe(Effect.result)
          )
        ).toBe(true);
        const { taskId, destActor } = yield* receivedTask(event.event_id);
        const captured = receiver.receipts.find((r) =>
          r.body.includes(event.event_id)
        );
        expect(captured).toBeDefined();
        if (!captured) throw new Error("Missing real homeserver event");
        yield* acceptMatrixTransaction(
          new Request("http://localhost/transactions", {
            method: "PUT",
            headers: { authorization: captured.authorization },
            body: captured.body,
          }),
          captured.id
        );
        expect(
          yield* sql`SELECT id FROM agent_protocol_tasks WHERE grant_id = ${room.grantId}`
        ).toHaveLength(1);
        expect((yield* readProtocolTask(destActor, taskId)).prompt).toBe(
          input.text
        );
        const nativeSession = `synthetic-telemetry-${randomUUID()}`;
        yield* bindProtocolSession(destActor, taskId, nativeSession);
        const delegatedPrincipal = {
          principalId: destActor.userId,
          principalType: "user",
          authenticator: "a2a",
          attributes: {
            workspaceId: destActor.workspaceId,
            agentGrantId: destActor.agentGrantId,
            protocolTaskId: taskId,
          },
        };
        const delegatedCatalog = yield* resolveExecutorTools(
          executorContext({
            session: {
              ...execution.session,
              auth: {
                current: delegatedPrincipal,
                initiator: delegatedPrincipal,
              },
            },
          })
        );
        expect(Object.keys(delegatedCatalog)).not.toContain("network-contact");
        expect(Object.keys(delegatedCatalog)).not.toContain("network-bots");
        // This is a transport/authorization proof; native model behavior has a separate eval.
        yield* finishProtocolTask(
          destActor,
          taskId,
          "TASK_STATE_COMPLETED",
          "Resposta de transporte do Bruno."
        );
        yield* publishMatrixProtocolAnswer(taskId);
        yield* publishMatrixProtocolAnswer(taskId);
        const principal = {
          principalType: "user",
          principalId: destActor.userId,
          authenticator: "a2a",
          attributes: {
            workspaceId: destActor.workspaceId,
            agentGrantId: destActor.agentGrantId,
            protocolTaskId: taskId,
          },
        };
        expect(
          (yield* telemetryScope(principal, nativeSession)).workspaceId
        ).toBe(destActor.workspaceId);
        expect(
          Result.isFailure(
            yield* telemetryScope(principal, "other-native-session").pipe(
              Effect.result
            )
          )
        ).toBe(true);
        const view = yield* readMatrixConversation(personal, room.id);
        expect(view.messages.map((m) => [m.fromBot, m.text])).toEqual([
          [false, input.text],
          [true, "Resposta de transporte do Bruno."],
        ]);
        expect(
          (yield* readMatrixResult(personal, room.id, event.event_id)).text
        ).toBe("Resposta de transporte do Bruno.");
        expect(
          Result.isFailure(
            yield* readMatrixResult(
              guestPersonal,
              room.id,
              event.event_id
            ).pipe(Effect.result)
          )
        ).toBe(true);
        expect(room.senderId).not.toBe(room.botId);
        const history = yield* matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/state/m.room.history_visibility`,
          undefined,
          room.senderId
        );
        expect(history).toEqual({ history_visibility: "joined" });
        const followup = yield* sendMatrixConversation(personal, {
          id: room.id,
          operationId: randomUUID(),
          text: "Continue the previous answer.",
        });
        const followupTask = yield* receivedTask(followup.event_id);
        const continued = yield* readProtocolTask(
          followupTask.destActor,
          followupTask.taskId
        );
        expect(continued.prompt).toContain("Resposta de transporte do Bruno.");
        expect(continued.prompt).toContain("Continue the previous answer.");
        expect(continued.prompt).toContain("untrusted context");
      }).pipe(Effect.scoped, Effect.provide(services))
    )
);

test(
  "distinct source/destination bots use Matrix identities and cancellation suppresses late results",
  { timeout: 60000 },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { personal, brunoBot, sql } = yield* fixture;
        const human = yield* openMatrixConversation(
          personal,
          brunoBot.username
        );
        const agent = yield* openMatrixConversation(
          personal,
          brunoBot.username,
          true
        );
        expect(agent.senderId).toContain("@_zoen_agent_");
        expect(agent.botId).toContain("@_zoen_agent_");
        expect(agent.senderId).not.toBe(agent.botId);
        expect(agent.roomId).not.toBe(human.roomId);
        const event = yield* sendMatrixConversation(personal, {
          id: agent.id,
          operationId: randomUUID(),
          text: "A tarefa do bot de Ana.",
        });
        const { taskId, destActor } = yield* receivedTask(event.event_id);
        const nativeSession = `synthetic-cancel-${randomUUID()}`;
        yield* bindProtocolSession(destActor, taskId, nativeSession);
        yield* cancelProtocolTask(destActor, taskId);
        expect(
          yield* sql`SELECT session_id FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`
        ).toHaveLength(1);
        yield* sql`DELETE FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`;
        yield* finishProtocolTask(
          destActor,
          taskId,
          "TASK_STATE_COMPLETED",
          "Late result must not appear"
        );
        yield* publishMatrixProtocolAnswer(taskId);
        expect(
          (yield* readMatrixConversation(personal, agent.id)).messages
        ).toHaveLength(1);
        expect((yield* readProtocolTask(destActor, taskId)).state).toBe(
          "TASK_STATE_CANCELED"
        );
        yield* closeMatrixConversation(personal, agent.id);
        yield* closeMatrixConversation(personal, agent.id);
        expect(
          yield* sql`SELECT room_id FROM matrix_room_retirements WHERE room_id = ${agent.roomId}`
        ).toHaveLength(1);
        yield* retireMatrixRooms();
        const joined = yield* matrixRequest(
          "GET",
          "joined_rooms",
          undefined,
          agent.senderId
        );
        expect(JSON.stringify(joined)).not.toContain(agent.roomId);
      }).pipe(Effect.scoped, Effect.provide(services))
    )
);

test(
  "blocking a peer prevents reads, sends and pending A2A output",
  { timeout: 60000 },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { personal, guestPersonal, ana, brunoBot } = yield* fixture;
        const room = yield* openMatrixConversation(personal, brunoBot.username);
        const event = yield* sendMatrixConversation(personal, {
          id: room.id,
          operationId: randomUUID(),
          text: "Before revoke",
        });
        const { taskId, destActor } = yield* receivedTask(event.event_id);
        yield* blockPersonalTrust(guestPersonal, { username: ana });
        expect(
          Result.isFailure(
            yield* readMatrixConversation(personal, room.id).pipe(Effect.result)
          )
        ).toBe(true);
        expect(
          Result.isFailure(
            yield* sendMatrixConversation(personal, {
              id: room.id,
              operationId: randomUUID(),
              text: "After revoke",
            }).pipe(Effect.result)
          )
        ).toBe(true);
        expect(
          Result.isFailure(
            yield* finishProtocolTask(
              destActor,
              taskId,
              "TASK_STATE_COMPLETED",
              "Do not deliver"
            ).pipe(Effect.result)
          )
        ).toBe(true);
        expect(
          Result.isFailure(
            yield* publishMatrixProtocolAnswer(taskId).pipe(Effect.result)
          )
        ).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(services))
    )
);

test(
  "removal from the source project destroys its grant even if company membership remains",
  { timeout: 60000 },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { actor, guest, sql } = yield* workspaceFixture();
        const bot = yield* saveWorkspaceBot(actor, profile("Company Zoen"));
        const room = yield* openMatrixConversation(guest, bot.username);
        const event = yield* sendMatrixConversation(guest, {
          id: room.id,
          operationId: randomUUID(),
          text: "Project request",
        });
        const { taskId, destActor } = yield* receivedTask(event.event_id);
        const nativeSession = `synthetic-remove-${randomUUID()}`;
        yield* bindProtocolSession(destActor, taskId, nativeSession);
        yield* removeWorkspaceMember(actor, guest.userId);
        expect(
          yield* sql`SELECT session_id FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`
        ).toHaveLength(1);
        yield* sql`DELETE FROM agent_protocol_cancellations WHERE session_id = ${nativeSession}`;
        expect(
          yield* sql`SELECT room_id FROM matrix_room_retirements WHERE room_id = ${room.roomId}`
        ).toHaveLength(1);
        expect(
          yield* sql`SELECT 1 FROM organization_memberships WHERE user_id = ${guest.userId}`
        ).toHaveLength(1);
        expect(
          yield* sql`SELECT 1 FROM workspace_agent_grants WHERE id = ${room.grantId}`
        ).toHaveLength(0);
        expect(
          Result.isFailure(
            yield* readProtocolTask(destActor, taskId).pipe(Effect.result)
          )
        ).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(services))
    )
);

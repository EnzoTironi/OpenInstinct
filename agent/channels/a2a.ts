import { defineChannel, GET, POST } from "eve/channels";
import { deliverProtocolCancellation } from "../../server/a2a/cancellation";
import { Effect, Schema } from "effect";
import { serverRuntime } from "../../server/runtime";
import { matrixConfiguration } from "../../server/matrix/client";
import {
  matrixProtocolTask,
  publishMatrixProtocolAnswer,
} from "../../server/matrix/network-delivery";
import { authenticateAgentGrant } from "../../server/workspaces/bots";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../../server/workspaces/access";
import { readAgentCard } from "../../server/a2a/card";
import { readRpcRequest, TaskQuery } from "../../server/a2a/request";
import { ListQuery, listProtocolTasks } from "../../server/a2a/list";
import {
  deliverProtocolTask,
  recoverableProtocolActor,
} from "../../server/a2a/delivery";
import {
  A2AError,
  A2AMessageSchema,
  acceptProtocolTask,
  cancelProtocolTask,
  awaitProtocolTask,
  finishProtocolTask,
  failProtocolSession,
  protocolTaskView,
  readProtocolTask,
} from "../../server/a2a/tasks";

const responseHeaders = { "cache-control": "no-store", "A2A-Version": "1.0" };
type RpcResult =
  | ReturnType<typeof protocolTaskView>
  | { task: ReturnType<typeof protocolTaskView> }
  | Effect.Success<ReturnType<typeof listProtocolTasks>>;

export default defineChannel({
  receive(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        if (
          Schema.is(Schema.Struct({ cancelSessionId: Schema.NonEmptyString }))(
            input.target
          )
        ) {
          if (
            input.auth?.principalType !== "runtime" ||
            input.auth.authenticator !== "app"
          )
            return yield* new WorkspaceAccessDenied();
          yield* deliverProtocolCancellation(
            input.target.cancelSessionId,
            context
          );
          return context.attachSession(input.target.cancelSessionId);
        }
        const target = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ taskId: Schema.String.check(Schema.isUUID()) })
        )(input.target);
        if (
          input.auth?.principalType === "service" &&
          input.auth.authenticator === "matrix-homeserver"
        ) {
          const config = yield* matrixConfiguration;
          const eventId = input.auth.attributes.matrixEventId;
          if (
            input.auth.principalId !== config.serverName ||
            !Schema.is(Schema.String)(eventId)
          )
            return yield* new WorkspaceAccessDenied();
          const mapped = yield* matrixProtocolTask(eventId);
          if (mapped?.taskId !== target.taskId)
            return yield* new WorkspaceAccessDenied();
        } else if (
          input.auth?.principalType !== "runtime" ||
          input.auth.authenticator !== "app"
        )
          return yield* new WorkspaceAccessDenied();
        const actor = yield* recoverableProtocolActor(target.taskId);
        return yield* deliverProtocolTask(actor, target.taskId, context);
      })
    );
  },
  routes: [
    GET("/agents/:username/agent-card", (request, { params }) =>
      serverRuntime.runPromise(
        readAgentCard(
          params.username ?? "",
          request.headers.get("authorization")
        ).pipe(
          Effect.map((card) =>
            Response.json(card, { headers: responseHeaders })
          ),
          Effect.catch(() =>
            Effect.succeed(
              Response.json(
                { error: "Agent not found" },
                { status: 404, headers: responseHeaders }
              )
            )
          )
        )
      )
    ),
    POST("/agents/:username", (request, { params, from, attachSession }) => {
      let id: string | number | null = null;
      return serverRuntime.runPromise(
        Effect.gen(function* () {
          // Authentication precedes body parsing, session lookup and protocol work.
          const identity = yield* authenticateAgentGrant(
            request.headers.get("authorization"),
            params.username ?? ""
          );
          const rpc = yield* readRpcRequest(request);
          id = rpc.id;
          const { actor } = identity;
          const grantId = actor.agentGrantId;
          if (!grantId)
            return yield* new A2AError({
              code: -32001,
              message: "Agent access denied",
            });
          const success = (result: RpcResult) =>
            Response.json(
              { jsonrpc: "2.0", id, result },
              { headers: responseHeaders }
            );
          if (rpc.method === "SendMessage") {
            const message = yield* Schema.decodeUnknownEffect(A2AMessageSchema)(
              rpc.params,
              { onExcessProperty: "error" }
            );
            const task = yield* acceptProtocolTask(actor, message);
            if (task.state === "TASK_STATE_SUBMITTED") {
              yield* deliverProtocolTask(actor, task.id, {
                from,
                attachSession,
              });
            }
            const result = message.configuration?.returnImmediately
              ? yield* readProtocolTask(actor, task.id)
              : yield* awaitProtocolTask(actor, task.id).pipe(
                  Effect.timeout("55 seconds"),
                  Effect.catchTag("TimeoutError", () =>
                    Effect.fail(
                      new A2AError({
                        code: -32000,
                        message:
                          "Task is still running. Use GetTask or retry with returnImmediately: true and the same message ID.",
                      })
                    )
                  )
                );
            return success({
              task: protocolTaskView(result),
            });
          } else if (rpc.method === "GetTask") {
            const query = yield* Schema.decodeUnknownEffect(TaskQuery)(
              rpc.params,
              { onExcessProperty: "error" }
            );
            return success(
              protocolTaskView(yield* readProtocolTask(actor, query.id))
            );
          } else if (rpc.method === "ListTasks") {
            const query = yield* Schema.decodeUnknownEffect(ListQuery)(
              rpc.params ?? {},
              { onExcessProperty: "error" }
            );
            return success(yield* listProtocolTasks(actor, query));
          } else if (rpc.method === "CancelTask") {
            const query = yield* Schema.decodeUnknownEffect(TaskQuery)(
              rpc.params,
              { onExcessProperty: "error" }
            );
            const task = yield* cancelProtocolTask(actor, query.id);
            const sessionId = task.sessionId;
            if (sessionId)
              yield* Effect.tryPromise({
                try: () => attachSession(sessionId).cancel(),
                catch: () =>
                  new A2AError({
                    code: -32603,
                    message: "Cancellation could not be delivered",
                  }),
              });
            return success(
              protocolTaskView(yield* readProtocolTask(actor, task.id))
            );
          } else
            return yield* new A2AError({
              code: -32601,
              message: "Method not supported",
            });
        }).pipe(
          Effect.catchTag("A2AError", (error) =>
            Effect.succeed(
              Response.json(
                {
                  jsonrpc: "2.0",
                  id,
                  error: { code: error.code, message: error.message },
                },
                { headers: responseHeaders }
              )
            )
          ),
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.succeed(
              Response.json(
                {
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32001, message: "Agent access denied" },
                },
                {
                  status: 401,
                  headers: { ...responseHeaders, "www-authenticate": "Bearer" },
                }
              )
            )
          ),
          Effect.catchTag("SchemaError", () =>
            Effect.succeed(
              Response.json(
                {
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32602, message: "Invalid method parameters" },
                },
                { headers: responseHeaders }
              )
            )
          ),
          Effect.catch(() =>
            Effect.succeed(
              Response.json(
                {
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: -32603,
                    message: "Service temporarily unavailable",
                  },
                },
                { status: 503, headers: responseHeaders }
              )
            )
          )
        )
      );
    }),
  ],
  events: {
    "session.failed"(event, channel) {
      return serverRuntime.runPromise(
        failProtocolSession(event.sessionId, channel.continuation?.token)
      );
    },
    async "message.completed"(event, _channel, context) {
      if (event.finishReason === "tool-calls") return;
      const caller = context.session.auth.current;
      const taskId = caller?.attributes.protocolTaskId;
      if (!caller || !Schema.is(Schema.String)(taskId)) return;
      await serverRuntime.runPromise(
        Effect.gen(function* () {
          const actor = yield* workspaceActorFromPrincipal(caller);
          const text = event.message ?? "";
          yield* finishProtocolTask(
            actor,
            taskId,
            "TASK_STATE_COMPLETED",
            text
          );
          yield* publishMatrixProtocolAnswer(taskId);
        }).pipe(Effect.catchTag("WorkspaceAccessDenied", () => Effect.void))
      );
    },
    async "turn.failed"(_event, _channel, context) {
      const caller = context.session.auth.current;
      const taskId = caller?.attributes.protocolTaskId;
      if (!caller || !Schema.is(Schema.String)(taskId)) return;
      await serverRuntime.runPromise(
        Effect.gen(function* () {
          const actor = yield* workspaceActorFromPrincipal(caller);
          yield* finishProtocolTask(
            actor,
            taskId,
            "TASK_STATE_FAILED",
            "The task could not be completed. Start a new task to retry."
          );
          yield* publishMatrixProtocolAnswer(taskId);
        }).pipe(Effect.catchTag("WorkspaceAccessDenied", () => Effect.void))
      );
    },
  },
});

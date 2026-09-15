import { Effect, Schema } from "effect";
import { defineChannel, GET, POST, PUT } from "eve/channels";
import { serverRuntime } from "../../server/runtime";
import {
  acceptMatrixTransaction,
  authorizeMatrixHomeserver,
} from "../../server/matrix/inbound";
import {
  deliverMatrixEvent,
  finishMatrixEvent,
} from "../../server/matrix/delivery";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { matrixConfiguration } from "../../server/matrix/client";
import { matrixProtocolTask } from "../../server/matrix/network-delivery";
import a2a from "./a2a";

export default defineChannel({
  receive(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        if (
          input.auth?.principalType !== "runtime" ||
          input.auth.authenticator !== "app"
        )
          return yield* new WorkspaceAccessDenied();
        const target = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ eventId: Schema.String })
        )(input.target);
        return yield* deliverMatrixEvent(target.eventId, context);
      })
    );
  },
  routes: [
    PUT("/_matrix/app/v1/transactions/:txnId", (request, context) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          const events = yield* acceptMatrixTransaction(
            request,
            context.params.txnId ?? ""
          );
          // Acknowledge persisted events even when native dispatch is temporarily down.
          context.waitUntil(
            serverRuntime.runPromise(
              Effect.forEach(
                events,
                (id) =>
                  Effect.gen(function* () {
                    const protocol = yield* matrixProtocolTask(id);
                    if (!protocol)
                      return yield* deliverMatrixEvent(id, context);
                    const config = yield* matrixConfiguration;
                    return yield* Effect.tryPromise(() =>
                      context
                        .to(a2a, { taskId: protocol.taskId })
                        .send("Resume accepted Matrix request", {
                          auth: {
                            principalType: "service",
                            principalId: config.serverName,
                            authenticator: "matrix-homeserver",
                            attributes: { matrixEventId: id },
                          },
                        })
                    );
                  }).pipe(
                    Effect.catch(() =>
                      Effect.logWarning("Matrix event awaits native recovery", {
                        eventId: id,
                      })
                    )
                  ),
                { concurrency: 2 }
              )
            )
          );
          return Response.json({});
        }).pipe(
          Effect.catchTag("MatrixError", (error) =>
            Effect.succeed(
              Response.json(
                { errcode: "M_FORBIDDEN" },
                { status: error.reason === "forbidden" ? 403 : 503 }
              )
            )
          ),
          Effect.catch(() =>
            Effect.succeed(
              Response.json({ errcode: "M_UNKNOWN" }, { status: 503 })
            )
          )
        )
      )
    ),
    POST("/_matrix/app/v1/ping", (request) =>
      serverRuntime.runPromise(
        authorizeMatrixHomeserver(request).pipe(
          Effect.as(Response.json({})),
          Effect.catch(() =>
            Effect.succeed(
              Response.json({ errcode: "M_FORBIDDEN" }, { status: 403 })
            )
          )
        )
      )
    ),
    GET("/_matrix/app/v1/users/:userId", (request, { params }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          yield* authorizeMatrixHomeserver(request);
          const config = yield* matrixConfiguration;
          return Response.json(
            {},
            { status: params.userId === config.botId ? 200 : 404 }
          );
        }).pipe(
          Effect.catch(() =>
            Effect.succeed(
              Response.json({ errcode: "M_FORBIDDEN" }, { status: 403 })
            )
          )
        )
      )
    ),
    GET("/_matrix/app/v1/rooms/:roomAlias", (request) =>
      serverRuntime.runPromise(
        authorizeMatrixHomeserver(request).pipe(
          Effect.as(Response.json({ errcode: "M_NOT_FOUND" }, { status: 404 })),
          Effect.catch(() =>
            Effect.succeed(
              Response.json({ errcode: "M_FORBIDDEN" }, { status: 403 })
            )
          )
        )
      )
    ),
  ],
  events: {
    async "session.failed"(_event, channel) {
      const token = channel.continuation?.token;
      if (!token?.startsWith("matrix:")) return;
      await serverRuntime.runPromise(
        finishMatrixEvent(
          token.slice(7),
          "Não consegui concluir esta tarefa. Mencione Zoen para tentar novamente."
        ).pipe(Effect.catchTag("WorkspaceAccessDenied", () => Effect.void))
      );
    },
    async "message.completed"(event, _channel, context) {
      if (event.finishReason === "tool-calls" || !event.message) return;
      const eventId = context.session.auth.current?.attributes.matrixEventId;
      if (!Schema.is(Schema.String)(eventId)) return;
      await serverRuntime.runPromise(
        finishMatrixEvent(eventId, event.message).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () => Effect.void)
        )
      );
    },
    async "turn.failed"(_event, _channel, context) {
      const eventId = context.session.auth.current?.attributes.matrixEventId;
      if (!Schema.is(Schema.String)(eventId)) return;
      await serverRuntime.runPromise(
        finishMatrixEvent(
          eventId,
          "Não consegui concluir esta tarefa. Mencione Zoen para tentar novamente."
        ).pipe(Effect.catchTag("WorkspaceAccessDenied", () => Effect.void))
      );
    },
  },
});

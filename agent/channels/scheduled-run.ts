import { serverRuntime } from "../../server/runtime";
import { requireScheduledChannelOwner } from "../../server/schedules/channel-owner";
import { defineChannel, POST } from "eve/channels";
import { routeAuth, vercelOidc } from "eve/channels/auth";
import { parseInputResponses, resolveTextToResponses } from "eve/client";
import { Config, ConfigProvider, Effect, Option, Result, Schema } from "effect";
import {
  ScheduledCallbackRejected,
  readScheduledCallbackBody,
  readVerifiedScheduledCallback,
  scheduledCallbackBodies,
  type ScheduledCallbackRoute,
} from "../../server/internal/scheduled-callback-auth";
import { dispatchScheduledReport } from "@agent/lib/schedules/report";
import {
  claimScheduledAgentRunInput,
  getScheduledReportChannel,
  finishScheduledAgentRunInput,
  restoreScheduledAgentRunInput,
} from "@db/services/scheduled-agent-jobs";

const scheduledRunTargetSchema = Schema.Struct({
  restart: Schema.optionalKey(Schema.Boolean),
  runId: Schema.String.check(Schema.isUUID()),
});

const authenticatedBody = Effect.fn("authenticatedScheduledCallbackBody")(
  function* (request: Request, route: ScheduledCallbackRoute) {
    const vercel = yield* Config.option(Config.string("VERCEL_ENV"));
    if (Option.isSome(vercel)) {
      const auth = yield* Effect.tryPromise({
        try: () => routeAuth(request, [vercelOidc()]),
        catch: () => new ScheduledCallbackRejected({ status: 401 }),
      });
      if (auth instanceof Response) return auth;
      return yield* readScheduledCallbackBody(request);
    }
    return yield* readVerifiedScheduledCallback(request, route);
  },
  Effect.catchTag("ConfigError", () =>
    Effect.fail(new ScheduledCallbackRejected({ status: 503 }))
  )
);

export default defineChannel({
  async receive(input, { from }) {
    const target = await Effect.runPromise(
      Schema.decodeUnknownEffect(scheduledRunTargetSchema, {
        onExcessProperty: "error",
      })(input.target)
    );
    const source = from(`scheduled-run:${target.runId}`);
    if (target.restart) {
      await source.reset({
        reason: "Scheduled worker exceeded its runtime.",
      });
    }
    return source.send(input.message, {
      auth: input.auth,
      title: `Scheduled run ${target.runId}`,
    });
  },
  routes: [
    POST(
      "/internal/scheduled-run/report",
      async (request, { attachSession, to, waitUntil }) => {
        return Effect.runPromise(
          Effect.gen(function* () {
            const raw = yield* authenticatedBody(
              request,
              "/internal/scheduled-run/report"
            );
            if (raw instanceof Response) return raw;
            const input = yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(
                scheduledCallbackBodies["/internal/scheduled-run/report"]
              ),
              { onExcessProperty: "error" }
            )(raw.toString("utf8")).pipe(
              Effect.mapError(
                () => new ScheduledCallbackRejected({ status: 400 })
              )
            );
            const channel = yield* Effect.tryPromise(() =>
              getScheduledReportChannel(input.runId)
            );
            if (channel)
              waitUntil(
                dispatchScheduledReport(
                  { attachSession, to },
                  input.runId,
                  channel
                )
              );
            return new Response(null, { status: 202 });
          }).pipe(
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromEnv()
            ),
            Effect.catchTag("ScheduledCallbackRejected", (error) =>
              Effect.succeed(
                new Response("Scheduled callback rejected", {
                  status: error.status,
                })
              )
            )
          ),
          { signal: request.signal }
        );
      }
    ),
    POST(
      "/internal/scheduled-run/respond",
      async (request, { attachSession }) => {
        const decoded = await Effect.runPromise(
          Effect.gen(function* () {
            const raw = yield* authenticatedBody(
              request,
              "/internal/scheduled-run/respond"
            );
            if (raw instanceof Response) return raw;
            return yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(
                scheduledCallbackBodies["/internal/scheduled-run/respond"]
              ),
              { onExcessProperty: "error" }
            )(raw.toString("utf8")).pipe(
              Effect.mapError(
                () => new ScheduledCallbackRejected({ status: 400 })
              )
            );
          }).pipe(
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromEnv()
            ),
            Effect.result
          ),
          { signal: request.signal }
        );
        if (Result.isFailure(decoded)) {
          return new Response("Scheduled callback rejected", {
            status: decoded.failure.status,
          });
        }
        if (decoded.success instanceof Response) return decoded.success;
        const input = decoded.success;
        const claimed = await claimScheduledAgentRunInput(
          input.runId,
          input.leaseToken
        );
        if (
          !claimed?.run.pendingInputRequests ||
          !claimed.run.workerSessionId
        ) {
          return new Response(null, { status: 409 });
        }
        const responses = parseInputResponses(
          resolveTextToResponses(input.answer, claimed.run.pendingInputRequests)
        );
        if (responses.length === 0) {
          await restoreScheduledAgentRunInput(
            input.runId,
            input.leaseToken,
            "The answer did not match the pending request."
          );
          return new Response(null, { status: 422 });
        }
        try {
          const channel = claimed.job.conversationChannel;
          if (channel === "telegram" || channel === "kapso") {
            await serverRuntime.runPromise(
              requireScheduledChannelOwner({
                ...claimed.job,
                conversationChannel: channel,
              })
            );
          }
          const attributes = {
            conversationChannel: claimed.job.conversationChannel,
            conversationId: claimed.job.conversationId,
            scheduleId: claimed.job.id,
            scheduledRunId: claimed.run.id,
            workspaceId: claimed.job.workspaceId,
          };
          const result = await attachSession(
            claimed.run.workerSessionId
          ).respond(responses, {
            auth: {
              attributes:
                channel === "telegram" || channel === "kapso"
                  ? {
                      ...attributes,
                      channelIdentityId: claimed.job.conversationId,
                    }
                  : attributes,
              authenticator: "scheduled-input",
              issuer: "open-instinct",
              principalId: claimed.job.createdByUserId,
              principalType: "user",
            },
          });
          if (result.status !== "accepted") {
            await restoreScheduledAgentRunInput(
              input.runId,
              input.leaseToken,
              "The scheduled session is no longer active."
            );
            return new Response(null, { status: 409 });
          }
          await finishScheduledAgentRunInput(input.runId, input.leaseToken);
          return new Response(null, { status: 202 });
        } catch (error) {
          await restoreScheduledAgentRunInput(
            input.runId,
            input.leaseToken,
            error instanceof Error ? error.message : String(error)
          );
          return new Response(null, { status: 502 });
        }
      }
    ),
  ],
});

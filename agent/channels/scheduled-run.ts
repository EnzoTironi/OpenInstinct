import { dispatchScheduledReport } from "@agent/lib/schedules/report";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import {
  claimScheduledAgentRunInput,
  getScheduledReportChannel,
  finishScheduledAgentRunInput,
  restoreScheduledAgentRunInput,
} from "@db/services/scheduled-agent-jobs";
import { ConfigProvider, Effect, Result, Schema } from "effect";
import { defineChannel, POST } from "eve/channels";
import { parseInputResponses, resolveTextToResponses } from "eve/client";

import {
  InternalCallbackRejected,
  readAuthenticatedInternalCallback,
  internalCallbackBodies,
} from "../../server/internal/callback-auth";
import { serverRuntime } from "../../server/runtime";
import { requireScheduledChannelOwner } from "../../server/schedules/channel-owner";

const decodeSchema_fromJsonString_internalCallbackBodies_inter =
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      internalCallbackBodies["/internal/scheduled-run/report"]
    ),
    { onExcessProperty: "error" }
  );

const decodeSchema_fromJsonString_internalCallbackBodies_inter2 =
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      internalCallbackBodies["/internal/scheduled-run/respond"]
    ),
    { onExcessProperty: "error" }
  );

const scheduledRunTargetSchema = Schema.Struct({
  restart: Schema.optionalKey(Schema.Boolean),
  runId: Schema.String.check(Schema.isUUID()),
});

const decodeEffect_scheduledRunTargetSchema_strict = Schema.decodeUnknownEffect(
  scheduledRunTargetSchema,
  {
    onExcessProperty: "error",
  }
);

type ScheduledAttachSession = (sessionId: string) => {
  respond: (
    responses: ReturnType<typeof parseInputResponses>,
    options: {
      readonly auth: {
        readonly attributes: Record<string, string>;
        readonly authenticator: string;
        readonly issuer: string;
        readonly principalId: string;
        readonly principalType: "user";
      };
    }
  ) => Promise<{ readonly status: string }>;
};

type ClaimedScheduledInput = NonNullable<
  Awaited<ReturnType<typeof claimScheduledAgentRunInput>>
>;

function mapRejectedDecodeStatus(cause: unknown) {
  if (cause instanceof InternalCallbackRejected) return cause.status;

  return 503;
}

function isNativeScheduledChannel(channel: string) {
  return channel === "telegram" || channel === "kapso";
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message;

  return String(cause);
}

function scheduledRespondAuthAttributes(claimed: ClaimedScheduledInput) {
  const attributes = {
    conversationChannel: claimed.job.conversationChannel,
    conversationId: claimed.job.conversationId,
    scheduleId: claimed.job.id,
    scheduledRunId: claimed.run.id,
    workspaceId: claimed.job.workspaceId,
  };

  if (!isNativeScheduledChannel(claimed.job.conversationChannel)) {
    return attributes;
  }

  return {
    ...attributes,
    channelIdentityId: claimed.job.conversationId,
  };
}

const decodeScheduledRespondCallback = Effect.fn(
  "decodeScheduledRespondCallback"
)(function* (request: Request) {
  const raw = yield* readAuthenticatedInternalCallback(
    request,
    "/internal/scheduled-run/respond"
  );

  if (raw instanceof Response) return raw;

  return yield* decodeSchema_fromJsonString_internalCallbackBodies_inter2(
    raw.toString("utf8")
  ).pipe(Effect.mapError(() => new InternalCallbackRejected({ status: 400 })));
});

async function decodeScheduledRespondInput(request: Request) {
  return Effect.runPromise(
    decodeScheduledRespondCallback(request).pipe(
      Effect.provide(ResolvedInstallationSecrets.layer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv()
      ),
      Effect.result
    ),
    { signal: request.signal }
  );
}

async function ensureScheduledChannelOwner(claimed: ClaimedScheduledInput) {
  const channel = claimed.job.conversationChannel;

  if (!isNativeScheduledChannel(channel)) return;

  await serverRuntime.runPromise(
    requireScheduledChannelOwner({
      ...claimed.job,
      conversationChannel: channel,
    })
  );
}

async function rejectEmptyScheduledResponses(
  input: {
    readonly leaseToken: string;
    readonly runId: string;
  },
  responses: ReturnType<typeof parseInputResponses>
) {
  if (responses.length > 0) return false;

  await restoreScheduledAgentRunInput(
    input.runId,
    input.leaseToken,
    "The answer did not match the pending request."
  );

  return true;
}

async function finishOrRestoreScheduledRespond(input: {
  readonly attachSession: ScheduledAttachSession;
  readonly claimed: ClaimedScheduledInput;
  readonly leaseToken: string;
  readonly responses: ReturnType<typeof parseInputResponses>;
  readonly runId: string;
}) {
  try {
    await ensureScheduledChannelOwner(input.claimed);

    const workerSessionId = input.claimed.run.workerSessionId;

    if (workerSessionId === undefined || workerSessionId === null) {
      throw new Error("Scheduled run is missing a worker session.");
    }

    const result = await input
      .attachSession(workerSessionId)
      .respond(input.responses, {
        auth: {
          attributes: scheduledRespondAuthAttributes(input.claimed),
          authenticator: "scheduled-input",
          issuer: "open-instinct",
          principalId: input.claimed.job.createdByUserId,
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
      errorMessage(error)
    );

    return new Response(null, { status: 502 });
  }
}

async function handleScheduledRespondRoute(
  request: Request,
  attachSession: ScheduledAttachSession
) {
  const decoded = await decodeScheduledRespondInput(request);

  if (Result.isFailure(decoded)) {
    return new Response("Scheduled callback rejected", {
      status: mapRejectedDecodeStatus(decoded.failure),
    });
  }

  if (decoded.success instanceof Response) return decoded.success;
  const input = decoded.success;

  const claimed = await claimScheduledAgentRunInput(
    input.runId,
    input.leaseToken
  );

  if (!claimed?.run.pendingInputRequests || !claimed.run.workerSessionId) {
    return new Response(null, { status: 409 });
  }

  const responses = parseInputResponses(
    resolveTextToResponses(input.answer, claimed.run.pendingInputRequests)
  );

  if (await rejectEmptyScheduledResponses(input, responses)) {
    return new Response(null, { status: 422 });
  }

  return finishOrRestoreScheduledRespond({
    attachSession,
    claimed,
    leaseToken: input.leaseToken,
    responses,
    runId: input.runId,
  });
}

export default defineChannel({
  async receive(input, { from }) {
    const target = await Effect.runPromise(
      decodeEffect_scheduledRunTargetSchema_strict(input.target)
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
            const raw = yield* readAuthenticatedInternalCallback(
              request,
              "/internal/scheduled-run/report"
            );

            if (raw instanceof Response) return raw;

            const input =
              yield* decodeSchema_fromJsonString_internalCallbackBodies_inter(
                raw.toString("utf8")
              ).pipe(
                Effect.mapError(
                  () => new InternalCallbackRejected({ status: 400 })
                )
              );

            const channel = yield* Effect.tryPromise({
              try: () => getScheduledReportChannel(input.runId),
              catch: () => new InternalCallbackRejected({ status: 503 }),
            });

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
            Effect.provide(ResolvedInstallationSecrets.layer),
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromEnv()
            ),
            Effect.catchTag("InternalCallbackRejected", (error) =>
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
    POST("/internal/scheduled-run/respond", (request, { attachSession }) =>
      handleScheduledRespondRoute(request, attachSession)
    ),
  ],
});

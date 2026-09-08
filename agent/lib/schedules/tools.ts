import type { ToolContext } from "eve/tools";
import { Effect, Option, Schema } from "effect";
import { scheduledConversationChannelSchema } from "../../../shared/schedules/conversation";
import { requireChannelPrincipal } from "../channel-session";
import {
  requireScheduleMembership,
  ScheduleOwnerInactive,
} from "../../../server/schedules/channel-owner";
import type {
  createScheduledAgentJob,
  listScheduledAgentJobs,
} from "@db/services/scheduled-agent-jobs";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";

export const scheduleOwner = Effect.fn("scheduleOwner")(function* (
  context: ToolContext
) {
  const auth = context.session.auth.current;
  if (auth?.principalType !== "user") return yield* new ScheduleOwnerInactive();
  const conversationChannel = yield* Schema.decodeUnknownEffect(
    scheduledConversationChannelSchema
  )(auth.attributes.conversationChannel);
  const scope = scopeFromPrincipal(auth);
  if (conversationChannel === "telegram" || conversationChannel === "kapso") {
    const identity = yield* requireChannelPrincipal(conversationChannel, auth);
    yield* requireScheduleMembership(scope);
    return {
      conversation: { conversationChannel, conversationId: identity.id },
      scope,
    };
  }
  const conversationId =
    conversationChannel === "eve"
      ? context.session.id
      : yield* Schema.decodeUnknownEffect(
          Schema.String.check(Schema.isStartsWith("linq:"))
        )(auth.attributes.conversationId);
  return { conversation: { conversationChannel, conversationId }, scope };
});

export function scheduleReplyAnchor(context: ToolContext) {
  const auth = context.session.auth.current;
  if (auth?.attributes.conversationChannel !== "linq") return undefined;
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.NonEmptyString)(
      auth.attributes.linqMessageId
    )
  );
}

export function scheduleSummary(
  job: Awaited<ReturnType<typeof createScheduledAgentJob>>
) {
  return {
    createdAt: job.createdAt.toISOString(),
    id: job.id,
    lastError: job.lastError,
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    nextRunAt: job.nextRunAt?.toISOString() ?? null,
    prompt: job.prompt,
    status: job.status,
    timing: job.timing,
  };
}

export function scheduleListSummary(
  job: Awaited<ReturnType<typeof listScheduledAgentJobs>>[number]
) {
  const latestRun = job.latestRun;
  return {
    ...scheduleSummary(job),
    latestRun: latestRun
      ? {
          completedAt: latestRun.completedAt?.toISOString() ?? null,
          id: latestRun.id,
          pendingInputRequests: latestRun.pendingInputRequests,
          lastError: latestRun.lastError,
          reportStatus: latestRun.reportStatus,
          scheduledFor: latestRun.scheduledFor.toISOString(),
          sessionId: latestRun.workerSessionId,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          status: latestRun.status,
        }
      : null,
  };
}

import type { ToolContext } from "eve/tools";
import { Option, Schema } from "effect";
import { scheduledConversationChannelSchema } from "../../../shared/schedules/conversation";
import { ScheduleOwnerInactive } from "../../../server/schedules/channel-owner";
import type {
  createScheduledAgentJob,
  listScheduledAgentJobs,
} from "@db/services/scheduled-agent-jobs";
import { scopeFromPrincipal } from "../../../shared/identity/principal-scope";

export function scheduleOwner(context: ToolContext) {
  const auth = context.session.auth.current;
  if (auth?.principalType !== "user") throw new ScheduleOwnerInactive();
  const conversationChannel = Schema.decodeUnknownSync(
    scheduledConversationChannelSchema
  )(auth.attributes.conversationChannel);
  const scope = scopeFromPrincipal(auth);
  const conversationId =
    conversationChannel === "eve"
      ? context.session.id
      : Schema.decodeUnknownSync(
          conversationChannel === "linq"
            ? Schema.String.check(Schema.isStartsWith("linq:"))
            : Schema.String.check(Schema.isUUID())
        )(auth.attributes.conversationId);
  return { conversation: { conversationChannel, conversationId }, scope };
}

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

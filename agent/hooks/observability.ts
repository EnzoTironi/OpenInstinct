import { defineHook } from "eve/hooks";
import { Effect } from "effect";
import { PgClient } from "@effect/sql-pg";
import { serverRuntime } from "../../server/runtime";
import { recordTelemetry } from "../../server/observability/events";
import { telemetryScope } from "../../server/observability/principal";
import { parseDiagnostic } from "../../shared/observability/redaction";
import { isSharedPrincipal } from "../../shared/identity/principal-scope";
import { requireChannelPrincipal } from "../../server/channels/principal";

export default defineHook({
  events: {
    "*": async (event, context) => {
      if (
        event.type.endsWith(".appended") ||
        event.type === "action.partial" ||
        event.type === "subagent.event" ||
        event.type === "reasoning.completed"
      )
        return;
      const principal =
        context.session.auth.current ?? context.session.auth.initiator;
      if (!principal || !event.meta.id) return;
      const unboundGroup =
        principal.authenticator === "verified-channel" &&
        isSharedPrincipal(principal) &&
        !principal.attributes.groupBindingId;
      await serverRuntime.runPromise(
        Effect.gen(function* () {
          if (unboundGroup) {
            const channel = principal.attributes.conversationChannel;
            if (channel !== "telegram" && channel !== "kapso") return;
            yield* requireChannelPrincipal(channel, principal);
          }
          const scope = unboundGroup
            ? undefined
            : yield* telemetryScope(principal, context.session.id);
          const sql = yield* PgClient.PgClient;
          const data = "data" in event ? event.data : {};
          const turnId = "turnId" in data ? data.turnId : undefined;
          const stepIndex = "stepIndex" in data ? data.stepIndex : null;
          const completed = event.type === "step.completed";
          const starts = completed
            ? yield* sql<{
                model: string | null;
                duration: number;
              }>`SELECT model,
        extract(epoch from (now() - created_at))::float8 * 1000 AS duration FROM telemetry_events
        WHERE session_id = ${context.session.id} AND turn_id = ${turnId ?? null} AND kind = 'step.started'
          AND metadata->>'stepIndex' = ${String(stepIndex)} ORDER BY created_at DESC LIMIT 1`
            : [];
          const status = event.type.endsWith(".failed")
            ? "failed"
            : event.type === "action.result"
              ? event.data.status
              : undefined;
          yield* recordTelemetry({
            id: `eve:${context.session.id}:${event.meta.id}`,
            workspaceId: scope?.workspaceId,
            userId: scope?.userId,
            sessionId: context.session.id,
            turnId,
            kind: event.type,
            channel: context.channel.kind,
            model:
              event.type === "step.started"
                ? event.data.modelId
                : (starts[0]?.model ?? undefined),
            durationMs: starts[0]?.duration,
            status,
            inputTokens: completed ? event.data.usage?.inputTokens : undefined,
            outputTokens: completed
              ? event.data.usage?.outputTokens
              : undefined,
            costUsd: completed ? event.data.usage?.costUsd : undefined,
            metadata: parseDiagnostic(
              JSON.stringify({
                agent: context.agent.name,
                scope: unboundGroup ? "channel-group" : "workspace",
                stepIndex,
                at: event.meta.at,
                runtime:
                  event.type === "session.started"
                    ? (event.data.runtime ?? null)
                    : null,
                trace:
                  event.type === "session.started"
                    ? (event.data.trace ?? null)
                    : null,
              })
            ),
            // An unbound group's operational metrics have no private owner.
            // Content capture needs the group's explicit workspace policy.
            payload: unboundGroup ? undefined : data,
          });
        }).pipe(
          Effect.timeout("3 seconds"),
          Effect.catchTag("WorkspaceAccessDenied", () => Effect.void),
          Effect.catchCause(() => Effect.logError("telemetry.write_failed"))
        )
      );
    },
  },
});

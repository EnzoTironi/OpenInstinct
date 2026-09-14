import { Effect, Schema } from "effect";
import { TRPCError } from "@trpc/server";
import {
  readDiagnosticSession,
  readInsights,
  reviewDiagnostic,
} from "../../server/observability/insights";
import {
  readTelemetryPolicy,
  updateTelemetryPolicy,
} from "../../server/observability/events";
import { serverRuntime } from "../../server/runtime";
import { workspaceProcedure } from "./workspace-procedure";

const failure = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Diagnostic access unavailable.",
  });
export const insightsRouter = {
  policy: workspaceProcedure.query(({ ctx, signal }) =>
    serverRuntime.runPromise(readTelemetryPolicy(ctx.actor.workspaceId), {
      signal,
    })
  ),
  read: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(Schema.Struct({ platform: Schema.Boolean }))
    )
    .query(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        readInsights(ctx.actor, input.platform).pipe(Effect.mapError(failure)),
        { signal }
      )
    ),
  session: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          sessionId: Schema.String.check(Schema.isMaxLength(200)),
          platform: Schema.Boolean,
          cursor: Schema.optional(
            Schema.NullOr(Schema.String.check(Schema.isMaxLength(200)))
          ),
        })
      )
    )
    .query(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        readDiagnosticSession(
          ctx.actor,
          input.sessionId,
          input.platform,
          input.cursor ?? null
        ).pipe(Effect.mapError(failure)),
        { signal }
      )
    ),
  review: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          sessionId: Schema.String.check(Schema.isMaxLength(200)),
          status: Schema.Literals([
            "new",
            "investigating",
            "resolved",
            "eval-candidate",
          ]),
        })
      )
    )
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        reviewDiagnostic(ctx.actor, input.sessionId, input.status).pipe(
          Effect.mapError(failure)
        ),
        { signal }
      )
    ),
  configure: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          captureContent: Schema.Boolean,
          retentionDays: Schema.Literals([7, 14, 30]),
        })
      )
    )
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        updateTelemetryPolicy(
          ctx.actor,
          input.captureContent,
          input.retentionDays
        ).pipe(Effect.mapError(failure)),
        { signal }
      )
    ),
};

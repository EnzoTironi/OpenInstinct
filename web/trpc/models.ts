import { Effect, Schema } from "effect";
import { TRPCError } from "@trpc/server";
import {
  ModelChallengeSchema,
  ModelProviderSchema,
  WorkspaceModelSchema,
} from "../../shared/models/catalog";
import {
  disconnectModel,
  finishModelConnection,
  readModelConnection,
  selectWorkspaceModel,
  startModelConnection,
} from "../../server/models/connections";
import { serverRuntime } from "../../server/runtime";
import { workspaceProcedure } from "./workspace-procedure";

const failure = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: "Model connection unavailable. Please reconnect.",
  });

export const modelsRouter = {
  read: workspaceProcedure.query(({ ctx, signal }) =>
    serverRuntime.runPromise(
      readModelConnection(ctx.actor).pipe(Effect.mapError(failure)),
      { signal }
    )
  ),
  start: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({ provider: ModelProviderSchema })
      )
    )
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        startModelConnection(ctx.actor, input.provider).pipe(
          Effect.mapError(
            () =>
              new TRPCError({
                code: "BAD_REQUEST",
                message: "Model authorization unavailable.",
              })
          )
        ),
        { signal }
      )
    ),
  poll: workspaceProcedure
    .input(Schema.toStandardSchemaV1(ModelChallengeSchema))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        finishModelConnection(ctx.actor, input.id).pipe(
          Effect.mapError(failure)
        ),
        {
          signal,
        }
      )
    ),
  select: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(Schema.Struct({ model: WorkspaceModelSchema }))
    )
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        selectWorkspaceModel(ctx.actor, input.model).pipe(
          Effect.mapError(failure)
        ),
        {
          signal,
        }
      )
    ),
  disconnect: workspaceProcedure.mutation(({ ctx, signal }) =>
    serverRuntime.runPromise(
      disconnectModel(ctx.actor).pipe(Effect.mapError(failure)),
      { signal }
    )
  ),
};

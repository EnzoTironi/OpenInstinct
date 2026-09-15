import { Schema } from "effect";
import { serverRuntime } from "../../server/runtime";
import {
  CustomerToolPublication,
  CustomerToolRollback,
  disableCustomerTool,
  listCustomerTools,
  publishCustomerTool,
  rollbackCustomerTool,
  validateCustomerTool,
} from "../../server/workspaces/tools";
import { workspaceProcedure } from "./workspace-procedure";

export const workspaceToolsRouter = {
  list: workspaceProcedure.query(({ ctx, signal }) =>
    serverRuntime.runPromise(listCustomerTools(ctx.actor), { signal })
  ),
  validate: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          content: Schema.String.check(Schema.isMaxLength(32_768)),
        })
      )
    )
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(validateCustomerTool(ctx.actor, input.content), {
        signal,
      })
    ),
  publish: workspaceProcedure
    .input(Schema.toStandardSchemaV1(CustomerToolPublication))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(publishCustomerTool(ctx.actor, input), {
        signal,
      })
    ),
  rollback: workspaceProcedure
    .input(Schema.toStandardSchemaV1(CustomerToolRollback))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(rollbackCustomerTool(ctx.actor, input), {
        signal,
      })
    ),
  disable: workspaceProcedure
    .input(Schema.toStandardSchemaV1(CustomerToolPublication))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(disableCustomerTool(ctx.actor, input), {
        signal,
      })
    ),
};

import { Effect, Schema } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { OntologyActionSchema } from "@shared/workspaces/ontology";
import { authorizeApprovalResponse } from "../lib/approval-response";
import { toolInputSchema } from "../lib/tool-input-schema";
import { workspaceOperationId } from "../lib/workspace-operation";
import { serverRuntime } from "../../server/runtime";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { applyOntologyAction } from "../../server/workspaces/ontology";
import { GitRevisionSchema } from "../../server/workspaces/git";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      if (context.session.auth.current?.authenticator !== "authjs") return null;
      return {
        "ontology-action": defineTool({
          description:
            "Apply a declared action to a structured entity after the user approves. First read workspace.ontology.read through Executor. Describe the entity, current value and proposed value. Only workspace admins can execute actions. A stale revision must be re-read and approved again.",
          approval: { request: always(), response: authorizeApprovalResponse },
          inputSchema: toolInputSchema(
            Schema.Struct({
              ...OntologyActionSchema.fields,
              expectedRevision: GitRevisionSchema,
              approvalMessage: Schema.String.check(
                Schema.isTrimmed(),
                Schema.isMinLength(1),
                Schema.isMaxLength(16_384)
              ),
            })
          ),
          execute: (input, execution) =>
            serverRuntime.runPromise(
              Effect.gen(function* () {
                const actor = yield* workspaceActorFromPrincipal(
                  execution.session.auth.current ?? undefined
                );
                return yield* applyOntologyAction(actor, {
                  ...input,
                  operationId: workspaceOperationId(
                    execution.session.id,
                    execution.callId
                  ),
                });
              }),
              { signal: execution.abortSignal }
            ),
        }),
      };
    },
  },
});

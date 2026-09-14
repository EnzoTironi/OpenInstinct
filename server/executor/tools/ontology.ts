import { Effect, Schema } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { OntologyActionSchema } from "@shared/workspaces/ontology";
import { authorizeApprovalResponse } from "../../../agent/lib/approval-response";
import { toolInputSchema } from "../../../agent/lib/tool-input-schema";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";
import { serverRuntime } from "../../runtime";
import { workspaceActorFromPrincipal } from "../../workspaces/access";
import { applyOntologyAction } from "../../workspaces/ontology";
import { GitRevisionSchema } from "../../workspaces/git";

export const ontologyActionInputSchema = Schema.Struct({
  ...OntologyActionSchema.fields,
  expectedRevision: GitRevisionSchema,
  approvalMessage: Schema.String.check(
    Schema.isPattern(/\S/u),
    Schema.isMinLength(1),
    Schema.isMaxLength(16_384)
  ),
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      if (context.session.auth.current?.authenticator !== "authjs") return null;
      return {
        "ontology-action": defineTool({
          description:
            "Propose a declared action to a structured entity. First read workspace.ontology.read through Executor. Invoke this tool with the entity, action, proposed value, revision and approvalMessage; Eve presents the exact native approval before any mutation. Do not request approval by sending a chat message. Only workspace admins can execute actions. A stale revision must be re-read and approved again.",
          approval: { request: always(), response: authorizeApprovalResponse },
          inputSchema: toolInputSchema(ontologyActionInputSchema),
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

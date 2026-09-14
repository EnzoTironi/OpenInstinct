import { Effect, Schema } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { serverRuntime } from "../../runtime";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../workspaces/access";
import { readWorkspaceCapabilities } from "../../workspaces/capabilities";
import { WorkspaceRepository } from "../../workspaces/repository";
import { WorkspacePathSchema, GitRevisionSchema } from "../../workspaces/git";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";
import { toolInputSchema } from "../../../agent/lib/tool-input-schema";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const caller = context.session.auth.current;
      if (
        caller?.principalType !== "user" ||
        ![
          "authjs",
          "verified-channel",
          "a2a",
          "matrix",
          "scheduled-worker",
        ].includes(caller.authenticator) ||
        (caller.attributes.chatKind === "group" &&
          !caller.attributes.groupBindingId)
      )
        return null;
      return {
        "workspace-save": defineTool({
          description:
            "Save a document the user requested into the active workspace. First read workspace.files.list and pass its revision as expectedRevision, even when creating a NEW FILE. expectedRevision is the WORKSPACE head; null is only for an entirely empty workspace. Show the user the path and result. Team documents are shared with members. This tool cannot edit agent instructions, skills or plugin permissions. Re-read and reconcile a conflicting edit before retrying.",
          inputSchema: toolInputSchema(
            Schema.Struct({
              path: WorkspacePathSchema.check(Schema.isPattern(/^knowledge\//)),
              expectedRevision: Schema.NullOr(GitRevisionSchema),
              content: Schema.String.check(Schema.isMaxLength(262_144)),
            })
          ),
          execute: (input, execution) =>
            serverRuntime.runPromise(
              Effect.gen(function* () {
                const actor = yield* workspaceActorFromPrincipal(
                  execution.session.auth.current ?? undefined
                );
                if (actor.agentGrantId)
                  return yield* new WorkspaceAccessDenied();
                if (
                  !(yield* readWorkspaceCapabilities(actor)).enabled.includes(
                    "files"
                  )
                )
                  return yield* new WorkspaceAccessDenied();
                const operationId = workspaceOperationId(
                  execution.session.id,
                  execution.callId
                );
                return yield* (yield* WorkspaceRepository).write(
                  actor,
                  { ...input, operationId },
                  { kind: "agent" }
                );
              }),
              { signal: execution.abortSignal }
            ),
        }),
      };
    },
  },
});

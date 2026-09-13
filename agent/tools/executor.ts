import { Effect, Schema } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { serverRuntime } from "../../server/runtime";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../server/workspaces/access";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import {
  executeWorkspace,
  readExecutorCatalog,
} from "../../server/executor/workspace";
import { ExecutorCodeSchema } from "../../server/executor/runtime";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import {
  WorkspacePathSchema,
  GitRevisionSchema,
} from "../../server/workspaces/git";
import { createHash } from "node:crypto";
import { toolInputSchema } from "../lib/tool-input-schema";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const caller = context.session.auth.current;
      if (
        caller?.principalType !== "user" ||
        !["authjs", "verified-channel"].includes(caller.authenticator) ||
        caller.attributes.chatKind === "group"
      )
        return null;
      return {
        "executor-catalog": defineTool({
          description:
            "Discover the current workspace's installed tools. All calls use this person's current permissions.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          execute: (_input, execution) =>
            serverRuntime.runPromise(
              Effect.gen(function* () {
                const actor = yield* workspaceActorFromPrincipal(
                  execution.session.auth.current ?? undefined
                );
                return yield* readExecutorCatalog(actor);
              }),
              { signal: execution.abortSignal }
            ),
        }),
        "executor-run": defineTool({
          description:
            'Run short JavaScript or TypeScript against the discovered workspace tools. An explicit return is REQUIRED: return await tools.workspace.files.list({}); or return await tools.workspace.files.read({path:"knowledge/example.md"}); Bare expressions are discarded. list takes only {} and returns {revision,files}; read returns {revision,path,content,nextOffset}. Search content with tools.workspace.files.search({query}); search learned facts with tools.workspace.memory.search({query}). No filesystem, fetch, credentials or arbitrary tools are available. This is read-only; use workspace-save for documents.',
          inputSchema: toolInputSchema(
            Schema.Struct({ code: ExecutorCodeSchema })
          ),
          execute: ({ code }, execution) =>
            serverRuntime.runPromise(
              Effect.gen(function* () {
                const actor = yield* workspaceActorFromPrincipal(
                  execution.session.auth.current ?? undefined
                );
                return yield* executeWorkspace(actor, code);
              }),
              { signal: execution.abortSignal }
            ),
        }),
        "workspace-save": defineTool({
          description:
            "Save a document the user requested into the active workspace. Read the latest revision first and show the user the path and result. Team documents are shared with members. This tool cannot edit agent instructions, skills or plugin permissions. A conflicting edit must be read and reconciled with the user before retrying.",
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
                if (
                  !(yield* readWorkspaceCapabilities(actor)).enabled.includes(
                    "files"
                  )
                )
                  return yield* new WorkspaceAccessDenied();
                const hash = createHash("sha256")
                  .update(`${execution.session.id}:${execution.callId}`)
                  .digest("hex");
                // RFC 9562 version 8 UUID, derived from the durable tool call identity.
                const operationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
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

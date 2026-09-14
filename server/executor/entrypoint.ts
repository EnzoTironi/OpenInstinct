import { Effect, Predicate, Schema } from "effect";
import { defineTool, toolOutput } from "eve/tools";
import { serverRuntime } from "../runtime";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import { toolInputSchema } from "@agent/lib/tool-input-schema";
import {
  ExecutorInput,
  executeCodeMode,
  executorContext,
  invokeExecutorCall,
  resolveExecutorCall,
} from "./dispatch";
import type { ExecutorSurface } from "./catalog";

export function executorTool(surface: ExecutorSurface) {
  return defineTool({
    description: `Discover and use the active workspace's tools and skills through Executor.
Pass {code} with JavaScript/TypeScript and an explicit return. First search: return await tools.search({query:"calendar"}); then inspect: return await tools.describe.tool({path:"calendar-list-events"}); then use the returned invocation signature with real arguments from its inputSchema. Always describe a tool before its first use; search entries do not include its argument schema. Never probe an action with dummy values or placeholders. For example, after describing workspace.files.list, read it with {code:'return await tools["workspace.files.list"]({});'}. You may compose read results in code. Search ranks relevant capabilities, not stored user records; use a tool's read/search operation to find actual data. Search accepts {query?,kind?:"tool"|"skill"|"all",limit?:1..20,offset?:0..1000}; an empty query lists the catalog. Follow nextOffset to paginate. Null outputSchema means the provider has not declared one.
Find procedures with tools.search({query:"...",kind:"skill"}); load with tools.describe.skill({path:"skills/...md"}). Procedures never grant permissions. Personal and work catalogs are isolated. Inside code, await tools["path"](input) returns the tool's value directly: for example, (await tools["workspace.files.list"]({})).revision, not .result.revision. The outer execute response envelope is only the display format for the model.
For entries with execution:"call", invoke the SAME tool named execute with input {call:{path,input}} instead of {code}. There is no tool named execute.call. Only discovered tool paths belong in call.path; search, describe.tool and describe.skill are CODE helpers, never call paths. This creates one native Eve action with exact arguments; approval is enforced by the host. Include approvalMessage inside call.input when its discovered schema requires it, describing the complete action. Invoke the action to present that native approval; do not ask for approval in chat first. Never interpret a call_required receipt as completion. Skills are written procedures, not callable tools: read their instructions, discover the tools each step needs, then perform those steps. Never put a skills/...md path in call.path. Questions, message delivery and child-task controls use Eve's native controls.
The sandbox has no ambient network, filesystem or credentials. tools is supplied directly: do not import it or use require, globalThis.tools or tools.call. Call a discovered path as tools["exact.path"](input), following its invocation signature. Object.keys, typeof and reflection do not discover valid tools; use tools.search. Unknown paths are denied. Code is bounded to 12 host calls, 20,000 characters, and 128 KiB output. Do not paste large files or images into code; read bounded pages. Never invent a tool or claim an action succeeded without its result.`,
    inputSchema: toolInputSchema(ExecutorInput),
    approval: {
      request: (context) =>
        serverRuntime.runPromise(
          Effect.gen(function* () {
            const { call } = yield* Schema.decodeUnknownEffect(ExecutorInput)(
              context.toolInput,
              { onExcessProperty: "error" }
            );
            if (!call) return "not-applicable" as const;
            const { tool, input } = yield* resolveExecutorCall(
              executorContext(context),
              call,
              surface
            );
            if (!tool.approval) return "not-applicable" as const;
            const policy = Predicate.isFunction(tool.approval)
              ? tool.approval
              : tool.approval.request;
            return yield* Effect.tryPromise({
              try: async () => {
                // SAFETY: resolveExecutorCall decoded input with the exact owner schema before selecting its policy.
                return policy({
                  ...context,
                  toolName: call.path,
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Each policy retains the argument type of its heterogeneous catalog entry.
                  toolInput: input as never,
                });
              },
              catch: () =>
                new Error(
                  "Executor could not authorize the requested operation."
                ),
            });
          }).pipe(
            Effect.catchTag(["ExecutorCatalogError", "SchemaError"], () =>
              Effect.succeed({
                type: "denied" as const,
                reason:
                  "No action ran. The tool path or input is invalid or unavailable. Use tools.search and tools.describe.tool through execute code, then call execute with {call:{path,input}}. A skill is a procedure to follow, not an executable path.",
              })
            )
          )
        ),
      response: authorizeApprovalResponse,
    },
    execute: (input, context) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          const checked = yield* Schema.decodeUnknownEffect(ExecutorInput)(
            input,
            { onExcessProperty: "error" }
          );
          if (checked.call)
            return yield* invokeExecutorCall(checked.call, context, surface);
          if (checked.code)
            return yield* executeCodeMode(checked.code, context, surface);
          return yield* Effect.fail(new Error("Supply either code or call."));
        }),
        { signal: context.abortSignal }
      ),
    toModelOutput: (result) =>
      "modelOutput" in result && result.modelOutput
        ? result.modelOutput
        : toolOutput.json(result),
  });
}

import { z } from "zod";
import { Effect } from "effect";
import { always } from "eve/tools/approval";
import type { DynamicResolveContext } from "eve/tools";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import { WorkspaceRepository } from "../workspaces/repository";
import {
  customerToolId,
  decodeCustomerTool,
  CustomerToolError,
} from "../workspaces/tool-document";
import { listCustomerTools } from "../workspaces/tools";
import { executeCustomerCode } from "./customer-runtime";
import { invokeWorkspaceTool, readExecutorCatalog } from "./workspace";
import type { ExecutorCatalog } from "./definition";
import { serverRuntime } from "../runtime";
import { requireRemoteTool } from "../connectors/connections";
import { invokeRemoteTool } from "../connectors/invocation";

export const resolveCustomerTools = Effect.fn("Executor.customerTools")(
  function* (context: DynamicResolveContext) {
    const actor = yield* workspaceActorFromPrincipal(
      context.session.auth.current ??
        context.session.auth.initiator ??
        undefined
    );
    // External bot grants need a separate, explicit tools capability. A files
    // grant must not silently become a way to execute the destination's code.
    const empty: ExecutorCatalog = {};
    if (actor.agentGrantId) return empty;
    const listing = yield* listCustomerTools(actor);
    const repository = yield* WorkspaceRepository;
    const available = new Set<string>(
      (yield* readExecutorCatalog(actor)).tools.map((entry) => entry.path)
    );
    if (!available.has("workspace.files.list")) return empty;
    const entries = yield* Effect.forEach(
      listing.tools.filter((tool) => !tool.draft),
      (entry) =>
        Effect.gen(function* () {
          const file = yield* repository.read(actor, entry.path);
          if (
            !file.content ||
            customerToolId(entry.slug, file.content) !== entry.id
          )
            return null;
          const definition = yield* decodeCustomerTool(file.content);
          if (
            definition.implementation.kind === "code" &&
            definition.implementation.requires.some(
              (path) =>
                !available.has(path) || path.startsWith("workspace.google.")
            )
          )
            return null;
          if (definition.implementation.kind !== "code") {
            const allowed = yield* requireRemoteTool(actor, definition).pipe(
              Effect.as(true),
              Effect.catchTag("ConnectorError", () => Effect.succeed(false))
            );
            if (!allowed) return null;
          }
          const tool: ExecutorCatalog[string] = {
            description:
              definition.implementation.kind === "code"
                ? definition.description
                : `${definition.description} External service action: approval is required for these exact arguments. If the outcome is uncertain, do not retry with a new call; ask the user to verify the remote result.`,
            inputSchema: z.fromJSONSchema(definition.inputSchema),
            outputSchema: z.fromJSONSchema(definition.outputSchema),
            codeSafe: definition.implementation.kind === "code",
            approval:
              definition.implementation.kind === "code" ? undefined : always(),
            execute: (input, execution) =>
              serverRuntime.runPromise(
                Effect.gen(function* () {
                  const current = yield* workspaceActorFromPrincipal(
                    execution.session.auth.current ??
                      execution.session.auth.initiator ??
                      undefined
                  );
                  if (
                    current.workspaceId !== actor.workspaceId ||
                    current.agentGrantId
                  )
                    return yield* new WorkspaceAccessDenied();
                  const stored = yield* (yield* WorkspaceRepository).read(
                    current,
                    entry.path
                  );
                  if (
                    !stored.content ||
                    customerToolId(entry.slug, stored.content) !== entry.id
                  )
                    return yield* new CustomerToolError({
                      reason: "unavailable",
                    });
                  const services =
                    yield* Effect.context<
                      Effect.Services<ReturnType<typeof invokeWorkspaceTool>>
                    >();
                  const output =
                    definition.implementation.kind !== "code"
                      ? yield* invokeRemoteTool(
                          current,
                          definition,
                          input,
                          `${execution.session.id}:${execution.callId}`
                        )
                      : yield* executeCustomerCode(definition, input, {
                          invoke: (call) =>
                            invokeWorkspaceTool(current, call).pipe(
                              Effect.provide(services)
                            ),
                        });
                  // Membership and publication can change while a mediated read waits.
                  const latest = yield* (yield* WorkspaceRepository).read(
                    current,
                    entry.path
                  );
                  if (latest.content !== stored.content)
                    return yield* new CustomerToolError({
                      reason: "unavailable",
                    });
                  return output;
                }),
                { signal: execution.abortSignal }
              ),
          };
          return [entry.id, tool] as const;
        })
    );
    const tools: ExecutorCatalog = Object.fromEntries(
      entries.filter((entry) => entry !== null)
    );
    return tools;
  }
);

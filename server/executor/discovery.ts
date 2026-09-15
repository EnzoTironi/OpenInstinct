import { Effect, Schema } from "effect";
import type { DynamicResolveContext } from "eve/tools";
import { workspaceActorFromPrincipal } from "../workspaces/access";
import { resolveModeValue } from "@agent/lib/mode";
import {
  codeReadableTools,
  resolveExecutorTools,
  type ExecutorSurface,
} from "./catalog";
import { describeToolSchema } from "./schemas";
import { ExecutorCatalogError } from "./errors";
import { readExecutorSkills, loadExecutorSkill } from "./skills";
import { rankCatalog } from "./search";
import { toolInputSchema } from "@agent/lib/tool-input-schema";
import { CustomerToolSchema } from "../workspaces/tool-document";

const Search = Schema.Struct({
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  kind: Schema.optionalKey(Schema.Literals(["tool", "skill", "all"])),
  offset: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))
  ),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))
  ),
});
const Describe = Schema.Struct({
  path: Schema.NonEmptyString.check(Schema.isMaxLength(240)),
});

export const discoverExecutor = Effect.fn("Executor.discover")(function* (
  context: DynamicResolveContext,
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Search and describe each decode their own sandbox input below.
  args: unknown,
  surface: ExecutorSurface = "coordinator"
) {
  const native = yield* resolveExecutorTools(context, surface);
  const reporting = resolveModeValue(context, { "scheduled-report": true });
  const actor = reporting
    ? null
    : yield* workspaceActorFromPrincipal(
        context.session.auth.current ??
          context.session.auth.initiator ??
          undefined
      );
  if (path === "describe.skill") {
    if (!actor)
      return yield* new ExecutorCatalogError({ reason: "unavailable" });
    const input = yield* Schema.decodeUnknownEffect(Describe)(args, {
      onExcessProperty: "error",
    });
    return yield* loadExecutorSkill(actor, input.path, Object.keys(native));
  }
  const tools = Object.entries(native).map(([name, tool]) => ({
    kind: "tool" as const,
    path: name,
    description: tool.description,
    execution:
      (codeReadableTools.has(name) || tool.codeSafe) &&
      tool.approval === undefined
        ? "code"
        : "call",
    approval: tool.approval !== undefined,
  }));
  if (path === "describe.tool") {
    const input = yield* Schema.decodeUnknownEffect(Describe)(args, {
      onExcessProperty: "error",
    });
    if (
      input.path === "customer.tool.definition" &&
      actor &&
      !actor.agentGrantId
    )
      return {
        kind: "definition" as const,
        path: input.path,
        instructions:
          "Author JSON at proposals/tools/<slug>.json using workspace-save. The owner tests and publishes in Space → Tools. Input and output schemas are JSON Schema objects with additionalProperties:false; supported types are object, array, string, number, integer and boolean. No references, regexes or executable schema extensions. Customer code receives input and may only invoke explicitly listed workspace read dependencies, excluding Google and customer tools. Tests use fixtures keyed by dependency path. Return an object. Published IDs contain the content version; use the discovered ID in skill requires. This definition grants no permissions.",
        schema: describeToolSchema(toolInputSchema(CustomerToolSchema)),
      };
    if (["search", "describe.tool", "describe.skill"].includes(input.path))
      return {
        kind: "tool" as const,
        path: input.path,
        execution: "code" as const,
        approval: false,
        invocation: `tools.${input.path}(input)`,
        inputSchema: describeToolSchema(
          toolInputSchema(input.path === "search" ? Search : Describe)
        ),
        outputSchema: null,
      };
    const tool = tools.find((candidate) => candidate.path === input.path);
    if (!tool)
      return yield* new ExecutorCatalogError({ reason: "unavailable" });
    const owner = native[tool.path];
    if (!owner)
      return yield* new ExecutorCatalogError({ reason: "unavailable" });
    return {
      ...tool,
      invocation:
        tool.execution === "code"
          ? `tools[${JSON.stringify(tool.path)}](input)`
          : `execute({call:{path:${JSON.stringify(tool.path)},input}})`,
      inputSchema: describeToolSchema(owner.inputSchema),
      outputSchema: owner.outputSchema
        ? describeToolSchema(owner.outputSchema)
        : null,
    };
  }
  if (path !== "search")
    return yield* new ExecutorCatalogError({ reason: "unavailable" });
  const input = yield* Schema.decodeUnknownEffect(Search)(args, {
    onExcessProperty: "error",
  });
  const skills =
    actor && (input.kind === "skill" || input.kind === "all")
      ? yield* readExecutorSkills(actor)
      : [];
  const searchable = [...(input.kind === "skill" ? [] : tools), ...skills];
  const matches = rankCatalog(searchable, input.query ?? "");
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 10;
  return {
    items: matches.slice(offset, offset + limit),
    total: matches.length,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
  };
});

import { isDeepStrictEqual } from "node:util";
import { Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { WorkspaceRepository, WorkspaceWriteSchema } from "./repository";
import { GitRevisionSchema } from "./git";
import {
  CustomerToolError,
  customerToolId,
  decodeCustomerTool,
  decodeCustomerValue,
  ToolProposalPath,
  PublishedToolPath,
  ToolSlug,
} from "./tool-document";
import { executeCustomerCode } from "../executor/customer-runtime";
import { readExecutorCatalog } from "../executor/workspace";
import { requireRemoteTool } from "../connectors/connections";

export const CustomerToolPublication = Schema.Struct({
  slug: ToolSlug,
  operationId: WorkspaceWriteSchema.fields.operationId,
  expectedRevision: WorkspaceWriteSchema.fields.expectedRevision,
});
export const CustomerToolRollback = Schema.Struct({
  ...CustomerToolPublication.fields,
  revision: GitRevisionSchema,
});

export const listCustomerTools = Effect.fn("CustomerTools.list")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const repository = yield* WorkspaceRepository;
  const listing = yield* repository.read(actor);
  const selection = yield* repository.selection(
    actor,
    listing.files.filter(
      (path) =>
        Schema.is(PublishedToolPath)(path) ||
        (!actor.agentGrantId &&
          !actor.groupBindingId &&
          Schema.is(ToolProposalPath)(path))
    )
  );
  const tools = yield* Effect.forEach(selection.documents, (document) =>
    Effect.gen(function* () {
      const definition = yield* decodeCustomerTool(document.content);
      const slug =
        document.path
          .split("/")
          .at(-1)
          ?.replace(/\.json$/u, "") ?? "";
      return {
        path: document.path,
        slug,
        name: definition.name,
        description: definition.description,
        id: customerToolId(slug, document.content),
        revision: selection.revision,
        draft: document.path.startsWith("proposals/"),
      };
    })
  );
  return { revision: selection.revision, tools };
});

export const validateCustomerTool = Effect.fn("CustomerTools.validate")(
  function* (actor: typeof WorkspaceActorSchema.Type, content: string) {
    yield* requireWorkspaceAccess(actor);
    if (actor.agentGrantId) return yield* new WorkspaceAccessDenied();
    const tool = yield* decodeCustomerTool(content);
    if (tool.implementation.kind !== "code") {
      yield* requireRemoteTool(actor, tool);
      yield* Effect.forEach(tool.tests, (test) =>
        Effect.gen(function* () {
          yield* decodeCustomerValue(tool.inputSchema, test.input);
          yield* decodeCustomerValue(tool.outputSchema, test.expected, true);
        })
      );
      return { name: tool.name, tests: 0, status: "validated" as const };
    }
    const available = new Set<string>(
      (yield* readExecutorCatalog(actor)).tools.map((entry) => entry.path)
    );
    // Customer code composes this workspace's bounded reads. Native actions and
    // other customer tools cannot be hidden inside it, even with an approval.
    if (
      tool.implementation.requires.some(
        (path) => !available.has(path) || path.startsWith("workspace.google.")
      )
    )
      return yield* new CustomerToolError({ reason: "dependency_unavailable" });
    yield* Effect.forEach(tool.tests, (test) =>
      Effect.gen(function* () {
        const result = yield* executeCustomerCode(tool, test.input, {
          invoke: (call) => {
            const fixture = test.fixtures[call.path];
            return fixture === undefined
              ? Effect.fail(new CustomerToolError({ reason: "test_failed" }))
              : Effect.succeed(fixture);
          },
        });
        if (!isDeepStrictEqual(result, test.expected))
          return yield* new CustomerToolError({ reason: "test_failed" });
        return undefined;
      })
    );
    return {
      name: tool.name,
      tests: tool.tests.length,
      status: "passed" as const,
    };
  }
);

export const publishCustomerTool = Effect.fn("CustomerTools.publish")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    input: typeof CustomerToolPublication.Type
  ) {
    yield* requireWorkspaceAccess(actor, true);
    const repository = yield* WorkspaceRepository;
    const proposal = `proposals/tools/${input.slug}.json`;
    const file = yield* repository.read(
      actor,
      proposal,
      input.expectedRevision ?? undefined
    );
    if (!file.content)
      return yield* new CustomerToolError({ reason: "unavailable" });
    yield* validateCustomerTool(actor, file.content);
    return yield* repository.write(
      actor,
      { ...input, path: `tools/${input.slug}.json`, content: file.content },
      { kind: "tool-publication", proposal }
    );
  }
);

export const rollbackCustomerTool = Effect.fn("CustomerTools.rollback")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    input: typeof CustomerToolRollback.Type
  ) {
    yield* requireWorkspaceAccess(actor, true);
    const repository = yield* WorkspaceRepository;
    const path = `tools/${input.slug}.json`;
    const file = yield* repository.read(actor, path, input.revision);
    if (!file.content)
      return yield* new CustomerToolError({ reason: "unavailable" });
    yield* validateCustomerTool(actor, file.content);
    return yield* repository.write(
      actor,
      { ...input, path, content: file.content },
      { kind: "tool-rollback", revision: input.revision }
    );
  }
);

export const disableCustomerTool = Effect.fn("CustomerTools.disable")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    input: typeof CustomerToolPublication.Type
  ) {
    yield* requireWorkspaceAccess(actor, true);
    return yield* (yield* WorkspaceRepository).write(
      actor,
      { ...input, path: `tools/${input.slug}.json`, content: null },
      { kind: "tool-disable" }
    );
  }
);

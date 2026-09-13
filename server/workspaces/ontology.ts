import { validateOntology } from "./ontology-validation";
import { Effect, Schema } from "effect";
import {
  emptyOntology,
  OntologyActionSchema,
  OntologyInvalid,
  ontologyPath,
  OntologySchema,
} from "@shared/workspaces/ontology";
import type { WorkspaceWriteSchema } from "./repository";
import { WorkspaceRepository } from "./repository";
import { requireWorkspaceAccess, type WorkspaceActorSchema } from "./access";

export const readOntology = Effect.fn("readOntology")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  const access = yield* requireWorkspaceAccess(actor);
  const selection = yield* (yield* WorkspaceRepository).selection(actor, [
    ontologyPath,
  ]);
  const document = selection.documents[0];
  const graph = document
    ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(OntologySchema))(
        document.content
      ).pipe(Effect.flatMap(validateOntology))
    : emptyOntology;
  return {
    graph,
    revision: selection.revision,
    mayManage: access.role !== "member" && !!actor.authSessionId,
  };
});

export const publishOntology = Effect.fn("publishOntology")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  input: Pick<
    typeof WorkspaceWriteSchema.Type,
    "operationId" | "expectedRevision"
  > & { readonly graph: typeof OntologySchema.Type },
  action?: Pick<typeof OntologyActionSchema.Type, "actionId" | "entityId">
) {
  yield* requireWorkspaceAccess(actor, true);
  const graph = yield* validateOntology(input.graph);
  const repository = yield* WorkspaceRepository;
  const checked = new Set<string>();
  for (const entity of graph.entities)
    for (const source of entity.sources) {
      const key = `${source.revision}:${source.path}`;
      if (checked.has(key)) continue;
      if (source.path.includes(".."))
        return yield* new OntologyInvalid({ reason: "source" });
      yield* repository.read(actor, source.path, source.revision);
      checked.add(key);
    }
  return yield* repository.write(
    actor,
    {
      path: ontologyPath,
      content: JSON.stringify(graph, null, 2),
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
    },
    { kind: "ontology", action }
  );
});

export const applyOntologyAction = Effect.fn("applyOntologyAction")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  input: typeof OntologyActionSchema.Type &
    Pick<typeof WorkspaceWriteSchema.Type, "operationId" | "expectedRevision">
) {
  yield* requireWorkspaceAccess(actor, true);
  const actionInput =
    yield* Schema.decodeUnknownEffect(OntologyActionSchema)(input);
  const graph =
    input.expectedRevision === null
      ? (yield* readOntology(actor)).graph
      : yield* validateOntology(
          yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(OntologySchema)
          )(
            (yield* (yield* WorkspaceRepository).read(
              actor,
              ontologyPath,
              input.expectedRevision
            )).content
          )
        );
  const action = graph.actions.find((item) => item.id === actionInput.actionId);
  const entity = graph.entities.find(
    (item) => item.id === actionInput.entityId
  );
  if (!action || !entity || entity.type !== action.entityType)
    return yield* new OntologyInvalid({ reason: "action" });
  return yield* publishOntology(
    actor,
    {
      ...input,
      graph: {
        ...graph,
        entities: graph.entities.map((item) =>
          item.id === entity.id
            ? Object.assign({}, item, {
                properties: {
                  ...item.properties,
                  [action.property]: actionInput.value,
                },
              })
            : item
        ),
      },
    },
    { actionId: actionInput.actionId, entityId: actionInput.entityId }
  );
});

import { Effect, Schema } from "effect";
import { OntologyInvalid, OntologySchema } from "@shared/workspaces/ontology";

/** No free-form code or inferred permissions in ontology definitions. */
export const validateOntology = Effect.fn("validateOntology")(function* (
  raw: typeof OntologySchema.Type
) {
  const graph = yield* Schema.decodeUnknownEffect(OntologySchema)(raw, {
    onExcessProperty: "error",
  });
  for (const records of [
    graph.types,
    graph.relations,
    graph.entities,
    graph.actions,
  ]) {
    if (new Set(records.map((item) => item.id)).size !== records.length)
      return yield* new OntologyInvalid({ reason: "duplicate" });
  }
  const types = new Map(graph.types.map((type) => [type.id, type]));
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  for (const type of graph.types) {
    if (
      new Set(type.properties.map((item) => item.id)).size !==
      type.properties.length
    )
      return yield* new OntologyInvalid({ reason: "duplicate" });
  }
  for (const entity of graph.entities) {
    const type = types.get(entity.type);
    if (!type) return yield* new OntologyInvalid({ reason: "type" });
    if (
      Object.keys(entity.properties).some(
        (id) => !type.properties.some((prop) => prop.id === id)
      )
    )
      return yield* new OntologyInvalid({ reason: "property" });
    for (const property of type.properties) {
      const value = entity.properties[property.id];
      if (value === undefined || value === null) {
        if (property.required)
          return yield* new OntologyInvalid({ reason: "property" });
      } else if (property.type === "date") {
        if (
          !Schema.is(
            Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
          )(value) ||
          Number.isNaN(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value
        )
          return yield* new OntologyInvalid({ reason: "property" });
      } else if (
        !Schema.is(
          {
            string: Schema.String,
            number: Schema.Finite,
            boolean: Schema.Boolean,
          }[property.type]
        )(value)
      )
        return yield* new OntologyInvalid({ reason: "property" });
    }
  }
  for (const relation of graph.relations) {
    if (!types.has(relation.from) || !types.has(relation.to))
      return yield* new OntologyInvalid({ reason: "link" });
  }
  const links = new Set<string>();
  for (const link of graph.links) {
    const relation = graph.relations.find((item) => item.id === link.type);
    const id = JSON.stringify(link);
    if (
      !relation ||
      relation.from !== entities.get(link.from)?.type ||
      relation.to !== entities.get(link.to)?.type ||
      links.has(id)
    )
      return yield* new OntologyInvalid({ reason: "link" });
    links.add(id);
  }
  for (const action of graph.actions) {
    if (
      !types
        .get(action.entityType)
        ?.properties.some((prop) => prop.id === action.property)
    )
      return yield* new OntologyInvalid({ reason: "action" });
  }
  return graph;
});

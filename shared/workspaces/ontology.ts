import { Schema } from "effect";

const key = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/));
const label = Schema.Trimmed.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(120)
);
const value = Schema.Union([
  Schema.String.check(Schema.isMaxLength(2000)),
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
]);
const property = Schema.Struct({
  id: key,
  name: label,
  type: Schema.Literals(["string", "number", "boolean", "date"]),
  required: Schema.Boolean,
});
export const OntologySchema = Schema.Struct({
  version: Schema.Literal(1),
  types: Schema.Array(
    Schema.Struct({
      id: key,
      name: label,
      properties: Schema.Array(property).check(Schema.isMaxLength(30)),
    })
  ).check(Schema.isMaxLength(30)),
  relations: Schema.Array(
    Schema.Struct({ id: key, name: label, from: key, to: key })
  ).check(Schema.isMaxLength(50)),
  entities: Schema.Array(
    Schema.Struct({
      id: key,
      type: key,
      name: label,
      properties: Schema.Record(key, value),
      sources: Schema.Array(
        Schema.Struct({
          path: Schema.String.check(
            Schema.isPattern(/^knowledge\/[a-zA-Z0-9_./-]+\.md$/)
          ),
          revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
        })
      ).check(Schema.isMaxLength(10)),
    })
  ).check(Schema.isMaxLength(500)),
  links: Schema.Array(Schema.Struct({ type: key, from: key, to: key })).check(
    Schema.isMaxLength(2000)
  ),
  actions: Schema.Array(
    Schema.Struct({ id: key, name: label, entityType: key, property: key })
  ).check(Schema.isMaxLength(30)),
});

export const emptyOntology: typeof OntologySchema.Type = {
  version: 1,
  types: [
    {
      id: "project",
      name: "Projeto",
      properties: [
        { id: "status", name: "Status", type: "string", required: false },
      ],
    },
    {
      id: "task",
      name: "Tarefa",
      properties: [
        { id: "status", name: "Status", type: "string", required: false },
      ],
    },
    { id: "person", name: "Pessoa", properties: [] },
    { id: "document", name: "Documento", properties: [] },
  ],
  relations: [
    { id: "part_of", name: "Parte de", from: "task", to: "project" },
    { id: "owned_by", name: "Responsável", from: "project", to: "person" },
    { id: "documents", name: "Documenta", from: "document", to: "project" },
  ],
  entities: [],
  links: [],
  actions: [
    {
      id: "project_status",
      name: "Atualizar projeto",
      entityType: "project",
      property: "status",
    },
    {
      id: "task_status",
      name: "Atualizar tarefa",
      entityType: "task",
      property: "status",
    },
  ],
};
export const ontologyPath = "ontology/workspace.json";
export const OntologyActionSchema = Schema.Struct({
  entityId: key,
  actionId: key,
  value,
});

export class OntologyInvalid extends Schema.TaggedError<OntologyInvalid>()(
  "OntologyInvalid",
  {
    reason: Schema.Literals([
      "duplicate",
      "type",
      "property",
      "link",
      "source",
      "action",
    ]),
  }
) {}

import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import { Schema } from "effect";

const graphSchema = Schema.Struct({
  revision: Schema.String,
  graph: Schema.Struct({
    entities: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        properties: Schema.Struct({ status: Schema.String }),
      })
    ),
  }),
});

export default defineEval({
  description:
    "Bind an ontology action to exact native approval, reject it, then approve a new proposal",
  tags: ["launch", "approval", "executor", "live-model", "synthetic-data"],
  timeoutMs: 240_000,
  async test(t) {
    const inspect = async () =>
      Schema.decodeUnknownSync(graphSchema)(
        await (await t.target.fetch("/_eval/ontology")).json()
      );
    const before = await inspect();
    const proposed = await t.send(
      "Set the Beta release project's status to active in this workspace."
    );
    proposed.parked();
    t.check((await inspect()).revision, equals(before.revision)).label(
      "no mutation before approval"
    );
    const first = t.requireInputRequest({
      toolName: "execute",
      optionIds: ["approve", "cancel"],
      input: {
        call: {
          path: "ontology-action",
          input: {
            entityId: "release_project",
            actionId: "project_status",
            value: "active",
            expectedRevision: before.revision,
          },
        },
      },
    });
    t.check(first.kind, equals("tool-approval"));
    const rejected = await t.respond([
      { requestId: first.requestId, optionId: "cancel" },
    ]);
    rejected.succeeded();
    t.calledTool("execute", {
      status: "rejected",
      input: { call: { path: "ontology-action" } },
      count: 1,
    });
    t.check((await inspect()).revision, equals(before.revision)).label(
      "rejection preserves the Git head"
    );
    const second = await t.send(
      "Please propose that same status change again. I will confirm it this time."
    );
    second.parked();
    const request = t.requireInputRequest({
      toolName: "execute",
      optionIds: ["approve", "cancel"],
      input: {
        call: {
          path: "ontology-action",
          input: {
            entityId: "release_project",
            actionId: "project_status",
            value: "active",
            expectedRevision: before.revision,
          },
        },
      },
    });
    t.check(request.requestId === first.requestId, equals(false)).label(
      "new proposal needs a new approval"
    );
    const approved = await t.respond([
      { requestId: request.requestId, optionId: "approve" },
    ]);
    approved.succeeded();
    approved.noFailedActions();
    t.calledTool("execute", {
      status: "completed",
      input: { call: { path: "ontology-action" } },
      count: 1,
    });
    const after = await inspect();
    t.check(
      after.graph.entities.find((entity) => entity.id === "release_project")
        ?.properties.status,
      equals("active")
    );
    t.check(after.revision === before.revision, equals(false)).label(
      "approved change has a new Git revision"
    );
  },
});

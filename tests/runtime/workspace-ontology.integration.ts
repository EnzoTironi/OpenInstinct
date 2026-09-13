import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Result } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect, test } from "vitest";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import {
  applyOntologyAction,
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import { emptyOntology } from "../../shared/workspaces/ontology";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
test("ontology actions retain sources and history, replay once, and reject foreign provenance or stale writes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, sql, repository } =
        yield* workspaceFixture();
      const source = yield* repository.write(actor, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/project.md",
        content: "# Project\nSynthetic source evidence.",
      });
      const privateSource = yield* repository.write(personal, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/private.md",
        content: "PRIVATE",
      });
      const graph = {
        ...emptyOntology,
        entities: [
          {
            id: "project_one",
            type: "project",
            name: "First project",
            properties: { status: "planned" },
            sources: [
              { path: "knowledge/project.md", revision: source.revision },
            ],
          },
          {
            id: "task_one",
            type: "task",
            name: "First task",
            properties: { status: "open" },
            sources: [],
          },
        ],
        links: [{ type: "part_of", from: "task_one", to: "project_one" }],
      };
      const saved = yield* publishOntology(actor, {
        operationId: randomUUID(),
        expectedRevision: source.revision,
        graph,
      });
      expect((yield* readOntology(guest)).graph.links).toEqual(graph.links);
      expect(
        Result.isFailure(
          yield* publishOntology(guest, {
            operationId: randomUUID(),
            expectedRevision: saved.revision,
            graph,
          }).pipe(Effect.result)
        )
      ).toBe(true);
      const action = {
        operationId: randomUUID(),
        expectedRevision: saved.revision,
        entityId: "project_one",
        actionId: "project_status",
        value: "active",
      };
      const changed = yield* applyOntologyAction(actor, action);
      expect(yield* applyOntologyAction(actor, action)).toEqual(changed);
      const exported = yield* repository.export(actor);
      if (!exported) throw new Error("Missing Git export");
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: "zoen-ontology-proof-",
      });
      yield* fs.writeFile(`${directory}/workspace.bundle`, exported.bundle);
      yield* spawner.string(
        ChildProcess.make("git", [
          "clone",
          "--bare",
          `${directory}/workspace.bundle`,
          `${directory}/repository`,
        ])
      );
      const commit = yield* spawner.string(
        ChildProcess.make("git", [
          "--git-dir",
          `${directory}/repository`,
          "show",
          "-s",
          "--format=%P%n%B",
          changed.revision,
        ])
      );
      expect(commit.split("\n")[0]).toBe(saved.revision);
      expect(commit).toContain(
        `Zoen-Metadata: ${JSON.stringify({ actor: actor.userId, operation: action.operationId, action: { actionId: action.actionId, entityId: action.entityId } })}`
      );
      expect(
        (yield* readOntology(guest)).graph.entities[0]?.properties.status
      ).toBe("active");
      expect(
        (yield* repository.read(
          actor,
          "ontology/workspace.json",
          saved.revision
        )).content
      ).toContain("planned");
      const history = yield* sql<{
        n: number;
      }>`SELECT count(*)::int AS n FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${action.operationId}`;
      expect(history[0]?.n).toBe(1);
      expect(
        Result.isFailure(
          yield* applyOntologyAction(actor, {
            ...action,
            operationId: randomUUID(),
            value: "overwritten",
          }).pipe(Effect.result)
        )
      ).toBe(true);
      const firstEntity = graph.entities[0];
      if (!firstEntity) throw new Error("Missing fixture entity");
      const foreign = {
        ...graph,
        entities: [
          {
            ...firstEntity,
            sources: [
              {
                path: "knowledge/private.md",
                revision: privateSource.revision,
              },
            ],
          },
          ...graph.entities.slice(1),
        ],
      };
      expect(
        Result.isFailure(
          yield* publishOntology(actor, {
            graph: foreign,
            operationId: randomUUID(),
            expectedRevision: changed.revision,
          }).pipe(Effect.result)
        )
      ).toBe(true);
      expect(
        Result.isFailure(
          yield* publishOntology(actor, {
            graph: {
              ...graph,
              links: [{ type: "part_of", from: "project_one", to: "task_one" }],
            },
            operationId: randomUUID(),
            expectedRevision: changed.revision,
          }).pipe(Effect.result)
        )
      ).toBe(true);
      yield* sql`DELETE FROM organization_memberships WHERE user_id = ${actor.userId}`;
      expect(
        Result.isFailure(
          yield* applyOntologyAction(actor, {
            ...action,
            expectedRevision: changed.revision,
          }).pipe(Effect.result)
        )
      ).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.provide(NodeServices.layer)
    )
  ));

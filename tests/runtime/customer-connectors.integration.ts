import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Result, type Scope } from "effect";
import type * as egress from "../../server/connectors/public-fetch";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  connectTools,
  listToolConnections,
  remoteToolDefinition,
  revokeToolConnection,
  toolConnectionCredentials,
} from "../../server/connectors/connections";
import { invokeRemoteTool } from "../../server/connectors/invocation";
import { ConnectorError } from "../../server/connectors/definition";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import {
  decodeCustomerTool,
  customerToolId,
} from "../../server/workspaces/tool-document";
import {
  publishCustomerTool,
  validateCustomerTool,
} from "../../server/workspaces/tools";
import { publishSkillProposal } from "../../server/workspaces/skills";
import { LearnedMemory } from "../../server/memory/learned";
import { Mem0 } from "../../server/memory/mem0";
import {
  executeCodeMode,
  executorContext,
  invokeExecutorCall,
} from "../../server/executor/dispatch";
import { resolveCustomerTools } from "../../server/executor/customer-tools";
import { runtimeDatabase } from "./database";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";
import { connectorDocument, connectorFixture } from "./connector-fixture";
import { linkedIdentity } from "./identity-fixture";

const endpoint = vi.hoisted(() => ({ origin: "" }));
// The service is an actual HTTP fixture. Only the public egress adapter is
// mapped to loopback here; its DNS/TLS enforcement has separate negative tests.
vi.mock("../../server/connectors/public-fetch", async (original) => {
  const actual = await original<typeof egress>();
  return {
    ...actual,
    publicFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname !== "connector.zoen.test")
        throw new Error("Unexpected fixture host");
      return fetch(`${endpoint.origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        body: request.body ? await request.text() : undefined,
      });
    },
  };
});
let fixture: Awaited<ReturnType<typeof connectorFixture>>;
beforeAll(async () => {
  fixture = await connectorFixture();
  endpoint.origin = fixture.origin;
});
afterAll(async () => {
  await fixture.close();
});
const services = LearnedMemory.layer.pipe(
  Layer.provideMerge(Mem0.layer),
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);
const run = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<typeof services> | Scope.Scope>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.provide(NodeServices.layer)
    )
  );

test.each(["mcp", "mcp-sse", "openapi"] as const)(
  "TL remote %s: import, publish, approval-gated discovery, dispatch once, revoke",
  (protocol) =>
    run(
      Effect.gen(function* () {
        const kind = protocol === "openapi" ? "openapi" : "mcp";
        const { personal, guestPersonal, repository, sql } =
          yield* workspaceFixture();
        const input = {
          id: randomUUID(),
          kind,
          name: "Synthetic notes",
          endpoint: `https://connector.zoen.test/${kind === "mcp" ? protocol : "api"}`,
          credential: "synthetic-connector-secret",
          share: "owner",
          document: kind === "openapi" ? connectorDocument : undefined,
        } satisfies Parameters<typeof connectTools>[1];
        const connection = yield* connectTools(personal, input);
        expect(yield* connectTools(personal, input)).toEqual(connection);
        expect(yield* listToolConnections(guestPersonal)).toEqual([]);
        const operation = connection.operations[0];
        expect(operation).toBeDefined();
        if (!operation) return;
        const definition = yield* decodeCustomerTool(
          JSON.stringify(remoteToolDefinition(connection, operation))
        );
        const content = JSON.stringify(definition);
        const draft = yield* repository.write(personal, {
          operationId: randomUUID(),
          expectedRevision: null,
          path: "proposals/tools/notes.json",
          content,
        });
        expect(yield* validateCustomerTool(personal, content)).toMatchObject({
          status: "validated",
          tests: 0,
        });
        yield* publishCustomerTool(personal, {
          slug: "notes",
          expectedRevision: draft.revision,
          operationId: randomUUID(),
        });
        const id = customerToolId("notes", content);
        const execution = workspaceExecutionFor(personal);
        const tools = yield* resolveCustomerTools(executorContext(execution));
        expect(tools[id]?.approval).toBeDefined();
        expect(tools[id]?.codeSafe).toBe(false);
        const before = fixture.writes.length;
        expect(
          (yield* executeCodeMode(
            `return await tools[${JSON.stringify(id)}](${JSON.stringify(kind === "mcp" ? { text: "blocked" } : { body: { text: "blocked" } })});`,
            execution
          )).text
        ).toContain("call_required");
        expect(fixture.writes.length).toBe(before);
        const args =
          kind === "mcp"
            ? { text: "written once" }
            : { body: { text: "written once" } };
        const key = `${execution.session.id}:${execution.callId}`;
        const result = (yield* invokeExecutorCall(
          { path: id, input: args },
          execution
        )).output;
        expect(result).toEqual({ text: "written once" });
        expect(
          yield* invokeRemoteTool(personal, definition, args, key)
        ).toEqual(result);
        expect(fixture.writes.length).toBe(before + 1);
        expect(fixture.credentials.at(-1)).toBe(
          "Bearer synthetic-connector-secret"
        );
        const rows =
          yield* sql`SELECT credentials FROM tool_connections WHERE id = ${connection.id}`;
        expect(JSON.stringify(rows)).not.toContain(input.credential);
        const files = yield* repository.selection(personal, [
          "tools/notes.json",
        ]);
        expect(JSON.stringify(files)).not.toContain(input.credential);
        const lost =
          kind === "mcp"
            ? { text: "lose response" }
            : { body: { text: "lose response" } };
        const lostKey = randomUUID();
        for (let attempt = 0; attempt < 2; attempt++) {
          const outcome = yield* invokeRemoteTool(
            personal,
            definition,
            lost,
            lostKey
          ).pipe(Effect.result);
          expect(Result.isFailure(outcome) && outcome.failure).toMatchObject({
            reason: "uncertain",
          });
        }
        expect(fixture.writes.length).toBe(before + 2);
        yield* revokeToolConnection(personal, connection.id);
        expect(yield* resolveCustomerTools(executorContext(execution))).toEqual(
          {}
        );
        expect(
          Result.isFailure(
            yield* invokeRemoteTool(personal, definition, args, key).pipe(
              Effect.result
            )
          )
        ).toBe(true);
        const revoked =
          yield* sql`SELECT credentials FROM tool_connections WHERE id = ${connection.id}`;
        expect(revoked[0]?.credentials).toBeNull();
      })
    )
);

test.each(["mcp", "openapi"] as const)(
  "TL remote %s: revocation during network wait blocks the next dispatch or withholds its result",
  (kind) =>
    run(
      Effect.gen(function* () {
        const { personal, sql } = yield* workspaceFixture();
        const connection = yield* connectTools(personal, {
          id: randomUUID(),
          kind,
          name: "Revocation proof",
          endpoint: `https://connector.zoen.test/${kind === "mcp" ? "mcp" : "api"}`,
          credential: "revocable-secret",
          share: "owner",
          document: kind === "openapi" ? connectorDocument : undefined,
        });
        const operation = connection.operations[0];
        if (!operation) throw new Error("Missing operation");
        const definition = yield* decodeCustomerTool(
          JSON.stringify(remoteToolDefinition(connection, operation))
        );
        fixture.paused.reached = Promise.withResolvers<undefined>();
        fixture.paused.resume = Promise.withResolvers<undefined>();
        fixture.paused.initialize = kind === "mcp";
        fixture.paused.response = kind === "openapi";
        const before = fixture.writes.length;
        const outcomes = yield* Effect.all(
          [
            invokeRemoteTool(
              personal,
              definition,
              kind === "mcp"
                ? { text: "revoked" }
                : { body: { text: "already dispatched" } },
              randomUUID()
            ).pipe(Effect.result),
            Effect.gen(function* () {
              yield* Effect.promise(() => fixture.paused.reached.promise);
              yield* revokeToolConnection(personal, connection.id);
              fixture.paused.resume.resolve(undefined);
            }),
          ],
          { concurrency: 2 }
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              fixture.paused.resume.resolve(undefined);
              fixture.paused.initialize = false;
              fixture.paused.response = false;
            })
          )
        );
        expect(Result.isFailure(outcomes[0])).toBe(true);
        expect(fixture.writes.length).toBe(
          before + (kind === "openapi" ? 1 : 0)
        );
        const receipts =
          yield* sql`SELECT result, status FROM tool_invocations WHERE connection_id = ${connection.id}`;
        expect(receipts).toMatchObject([{ result: null, status: "uncertain" }]);
      })
    )
);

test("TL remote: personal credentials never leak to company members or groups; workspace sharing is explicit", () =>
  run(
    Effect.gen(function* () {
      const { actor, guest, sql, repository } = yield* workspaceFixture();
      const connection = yield* connectTools(actor, {
        id: randomUUID(),
        kind: "openapi",
        name: "Owner only",
        endpoint: "https://connector.zoen.test/api",
        credential: "owner-secret",
        share: "owner",
        document: connectorDocument,
      });
      expect(yield* listToolConnections(guest)).toEqual([]);
      expect(
        Result.isFailure(
          yield* connectTools(guest, {
            id: randomUUID(),
            kind: "openapi",
            name: "No grant",
            endpoint: "https://connector.zoen.test/api",
            credential: "nope",
            share: "workspace",
            document: connectorDocument,
          }).pipe(Effect.result)
        )
      ).toBe(true);
      const installationId = `connectors-${randomUUID()}`;
      const identity = yield* linkedIdentity(
        { channel: "telegram", installationId, senderId: "owner" },
        { userId: actor.userId.slice("better-auth:".length) }
      );
      const bindingId = randomUUID();
      yield* sql`INSERT INTO workspace_group_bindings(id, workspace_id, channel, installation_id, conversation_id, label, created_by)
    VALUES (${bindingId}, ${actor.workspaceId}, 'telegram', ${installationId}, ${`connector-group-${bindingId}`}, 'Synthetic connector group', ${actor.userId})`;
      const group = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        channelIdentityId: identity.id,
        groupBindingId: bindingId,
      };
      expect(yield* listToolConnections(group)).toEqual([]);
      const shared = yield* connectTools(actor, {
        id: randomUUID(),
        kind: "openapi",
        name: "Team notes",
        endpoint: "https://connector.zoen.test/api",
        credential: "team-secret",
        share: "workspace",
        document: connectorDocument,
      });
      expect(
        (yield* listToolConnections(guest)).map((entry) => entry.id)
      ).toEqual([shared.id]);
      expect(
        (yield* listToolConnections(group)).map((entry) => entry.id)
      ).toEqual([shared.id]);
      const operation = shared.operations[0];
      if (!operation) throw new Error("Missing operation");
      const definition = yield* decodeCustomerTool(
        JSON.stringify(remoteToolDefinition(shared, operation))
      );
      const content = JSON.stringify(definition);
      const draft = yield* repository.write(group, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "proposals/tools/group-notes.json",
        content,
      });
      const publication = {
        slug: "group-notes",
        expectedRevision: draft.revision,
        operationId: randomUUID(),
      };
      expect(
        Result.isFailure(
          yield* publishCustomerTool(group, publication).pipe(Effect.result)
        )
      ).toBe(true);
      const published = yield* publishCustomerTool(actor, publication);
      const id = customerToolId("group-notes", content);
      const skill = yield* repository.write(group, {
        operationId: randomUUID(),
        expectedRevision: published.revision,
        path: "proposals/skills/group-notes.md",
        content: `---\nrequires: [${id}]\n---\n# Shared notes\n\nCreate a note through the pinned service action after approval.\n`,
      });
      yield* publishSkillProposal(actor, {
        operationId: randomUUID(),
        expectedRevision: skill.revision,
        proposal: "proposals/skills/group-notes.md",
      });
      const base = workspaceExecutionFor(actor);
      const principal = {
        principalId: actor.userId,
        principalType: "user",
        authenticator: "verified-channel",
        attributes: {
          chatKind: "group",
          workspaceId: actor.workspaceId,
          channelIdentityId: identity.id,
          groupBindingId: bindingId,
        },
      };
      const execution = {
        ...base,
        session: {
          ...base.session,
          auth: { current: principal, initiator: principal },
        },
      };
      expect(
        (yield* executeCodeMode(
          'return await tools.describe.skill({path:"skills/group-notes.md"});',
          execution
        )).text
      ).toContain('"execution":"instructions"');
      expect(
        (yield* executeCodeMode(
          'return await tools["workspace.tools.connections"]({});',
          execution
        )).text
      ).toContain(shared.id);
      expect(
        (yield* invokeExecutorCall(
          { path: id, input: { body: { text: "group native write" } } },
          execution
        )).output
      ).toEqual({ text: "group native write" });
      yield* invokeRemoteTool(
        group,
        definition,
        { body: { text: "group write" } },
        randomUUID()
      );
      yield* sql`UPDATE tool_connections SET credentials = (SELECT credentials FROM tool_connections WHERE id = ${connection.id}) WHERE id = ${shared.id}`;
      expect(
        Result.isFailure(
          yield* toolConnectionCredentials(
            actor,
            shared.id,
            shared.revision
          ).pipe(Effect.result)
        )
      ).toBe(true);
      yield* sql`DELETE FROM organization_memberships WHERE organization_id = (SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}) AND user_id = ${guest.userId}`;
      expect(
        Result.isFailure(yield* listToolConnections(guest).pipe(Effect.result))
      ).toBe(true);
    })
  ));

test("TL remote: competing delivery and changed arguments do not cause another write", () =>
  run(
    Effect.gen(function* () {
      const { personal } = yield* workspaceFixture();
      const connection = yield* connectTools(personal, {
        id: randomUUID(),
        kind: "openapi",
        name: "Notes",
        endpoint: "https://connector.zoen.test/api",
        credential: "",
        share: "owner",
        document: connectorDocument,
      });
      const operation = connection.operations[0];
      if (!operation) throw new Error("Missing operation");
      const definition = yield* decodeCustomerTool(
        JSON.stringify(remoteToolDefinition(connection, operation))
      );
      const key = randomUUID();
      const before = fixture.writes.length;
      const outcomes = yield* Effect.all(
        [1, 2].map(() =>
          invokeRemoteTool(
            personal,
            definition,
            { body: { text: "concurrent" } },
            key
          ).pipe(Effect.result)
        ),
        { concurrency: 2 }
      );
      expect(outcomes.some(Result.isSuccess)).toBe(true);
      expect(fixture.writes.length).toBe(before + 1);
      const mismatch = yield* invokeRemoteTool(
        personal,
        definition,
        { body: { text: "different" } },
        key
      ).pipe(Effect.result);
      expect(
        Result.isFailure(mismatch) &&
          mismatch.failure instanceof ConnectorError &&
          mismatch.failure.reason
      ).toBe("changed");
      expect(fixture.writes.length).toBe(before + 1);
    })
  ));

test("TL remote: removing the credential owner erases the connection and receipts before any rejoin", () =>
  run(
    Effect.gen(function* () {
      const { actor, guest, sql } = yield* workspaceFixture();
      const connection = yield* connectTools(actor, {
        id: randomUUID(),
        kind: "openapi",
        name: "Donor connection",
        endpoint: "https://connector.zoen.test/api",
        credential: "do-not-retain-this",
        share: "workspace",
        document: connectorDocument,
      });
      const operation = connection.operations[0];
      if (!operation) throw new Error("Missing operation");
      const definition = yield* decodeCustomerTool(
        JSON.stringify(remoteToolDefinition(connection, operation))
      );
      yield* invokeRemoteTool(
        guest,
        definition,
        { body: { text: "before removal" } },
        randomUUID()
      );
      yield* sql`DELETE FROM organization_memberships WHERE organization_id = (SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}) AND user_id = ${actor.userId}`;
      expect(
        yield* sql`SELECT id FROM tool_connections WHERE id = ${connection.id}`
      ).toEqual([]);
      expect(
        yield* sql`SELECT id FROM tool_invocations WHERE connection_id = ${connection.id}`
      ).toEqual([]);
      yield* sql`INSERT INTO organization_memberships(organization_id, user_id, role) SELECT organization_id, ${actor.userId}, 'admin' FROM workspaces WHERE id = ${actor.workspaceId}`;
      expect(yield* listToolConnections(guest)).toEqual([]);
      expect(
        Result.isFailure(
          yield* invokeRemoteTool(
            guest,
            definition,
            { body: { text: "after rejoin" } },
            randomUUID()
          ).pipe(Effect.result)
        )
      ).toBe(true);
    })
  ));

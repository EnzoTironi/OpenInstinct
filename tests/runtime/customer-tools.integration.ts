import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import {
  executeCodeMode,
  executorContext,
  invokeExecutorCall,
} from "../../server/executor/dispatch";
import { resolveCustomerTools } from "../../server/executor/customer-tools";
import { LearnedMemory } from "../../server/memory/learned";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { publishSkillProposal } from "../../server/workspaces/skills";
import { customerToolId } from "../../server/workspaces/tool-document";
import {
  disableCustomerTool,
  publishCustomerTool,
  rollbackCustomerTool,
  validateCustomerTool,
} from "../../server/workspaces/tools";
import { runtimeDatabase } from "./database";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import { linkedIdentity } from "./identity-fixture";

const services = LearnedMemory.layer.pipe(
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);
const objectSchema = {
  type: "object",
  properties: { text: { type: "string", maxLength: 100 } },
  required: ["text"],
  additionalProperties: false,
};
const manifest = (code = "return { text: input.text.trim() };") =>
  JSON.stringify({
    name: "Organize my inbox",
    description: "Normalize an email subject.",
    inputSchema: objectSchema,
    outputSchema: objectSchema,
    implementation: { kind: "code", code, requires: [] },
    tests: [
      { input: { text: " Hello " }, expected: { text: "Hello" }, fixtures: {} },
    ],
  });

test("TL: publish, discover, compose and revoke a versioned personal tool and its skill", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { personal, guestPersonal, repository } = yield* workspaceFixture();
      const template = yield* executeCodeMode(
        'return await tools.describe.tool({path:"customer.tool.definition"});',
        workspaceExecutionFor(personal)
      );
      expect(template.text).toContain('"kind":"definition"');
      expect(template.text).toContain("inputSchema");
      const content = manifest();
      const id = customerToolId("inbox", content);
      const drafted = yield* repository.write(personal, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "proposals/tools/inbox.json",
        content,
      });
      const input = {
        slug: "inbox",
        operationId: randomUUID(),
        expectedRevision: drafted.revision,
      };
      expect(yield* validateCustomerTool(personal, content)).toMatchObject({
        status: "passed",
        tests: 1,
      });
      const published = yield* publishCustomerTool(personal, input);
      expect(yield* publishCustomerTool(personal, input)).toEqual(published);
      const skill = yield* repository.write(personal, {
        operationId: randomUUID(),
        expectedRevision: published.revision,
        path: "proposals/skills/inbox.md",
        content: `---\nrequires: [${id}]\n---\n# Organize my inbox\n\nUse the pinned subject normalization tool.\n`,
      });
      const skillPublished = yield* publishSkillProposal(personal, {
        operationId: randomUUID(),
        expectedRevision: skill.revision,
        proposal: "proposals/skills/inbox.md",
      });
      const execution = workspaceExecutionFor(personal);
      const code = `return await tools[${JSON.stringify(id)}]({text: " Done "});`;
      const results = yield* Effect.all(
        Array.from({ length: 4 }, () => executeCodeMode(code, execution)),
        { concurrency: 4 }
      );
      expect(
        results.every(
          (result) => result.ok && result.text.includes('"text":"Done"')
        )
      ).toBe(true);
      expect(
        (yield* executeCodeMode(
          'return await tools.describe.skill({path:"skills/inbox.md"});',
          execution
        )).text
      ).toContain('"execution":"instructions"');
      expect(
        yield* resolveCustomerTools(
          executorContext(workspaceExecutionFor(guestPersonal))
        )
      ).toEqual({});
      const cached = (yield* resolveCustomerTools(executorContext(execution)))[
        id
      ];
      if (!cached) throw new Error("Missing published tool");
      const disabled = yield* disableCustomerTool(personal, {
        slug: "inbox",
        expectedRevision: skillPublished.revision,
        operationId: randomUUID(),
      });
      const cachedCall = yield* Effect.tryPromise(() => {
        // SAFETY: this input matches objectSchema; exercise the retained descriptor after revoke.
        return Promise.resolve(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          cached.execute({ text: "Denied" } as never, execution)
        );
      }).pipe(Effect.result);
      expect(Result.isFailure(cachedCall)).toBe(true);
      expect(
        Result.isFailure(
          yield* invokeExecutorCall(
            { path: id, input: { text: "Denied" } },
            execution
          ).pipe(Effect.result)
        )
      ).toBe(true);
      expect(
        (yield* executeCodeMode(
          'return await tools.describe.skill({path:"skills/inbox.md"});',
          execution
        )).text
      ).toContain('"execution":"blocked"');
      const restored = yield* rollbackCustomerTool(personal, {
        slug: "inbox",
        operationId: randomUUID(),
        expectedRevision: disabled.revision,
        revision: published.revision,
      });
      expect(restored.revision).not.toBe(published.revision);
      expect((yield* executeCodeMode(code, execution)).text).toContain(
        '"text":"Done"'
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.provide(NodeServices.layer)
    )
  ));

test("TL: team member proposes but cannot bypass validated publication", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, repository } = yield* workspaceFixture();
      const draft = yield* repository.write(guest, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "proposals/tools/meeting.json",
        content: manifest(),
      });
      const denied = yield* publishCustomerTool(guest, {
        slug: "meeting",
        operationId: randomUUID(),
        expectedRevision: draft.revision,
      }).pipe(Effect.result);
      expect(Result.isFailure(denied) && denied.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      const bypass = yield* repository
        .write(actor, {
          operationId: randomUUID(),
          expectedRevision: draft.revision,
          path: "tools/meeting.json",
          content: manifest(),
        })
        .pipe(Effect.result);
      expect(Result.isFailure(bypass) && bypass.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      yield* publishCustomerTool(actor, {
        slug: "meeting",
        operationId: randomUUID(),
        expectedRevision: draft.revision,
      });
      expect(
        (yield* executeCodeMode(
          `return await tools[${JSON.stringify(customerToolId("meeting", manifest()))}]({text:" Ready "});`,
          workspaceExecutionFor(guest)
        )).text
      ).toContain('"text":"Ready"');
    }).pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.provide(NodeServices.layer)
    )
  ));

test.each([
  "return {text: process.env.SECRET};",
  "return {text: require('node:fs').readFileSync('/etc/passwd')};",
  "while(true) {}",
  "return {text: 'wrong'};",
  "return await tools.workspace.files.list({});",
])("TL: invalid or malicious customer code cannot be published: %s", (code) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { personal } = yield* workspaceFixture();
      expect(
        Result.isFailure(
          yield* validateCustomerTool(personal, manifest(code)).pipe(
            Effect.result
          )
        )
      ).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.provide(NodeServices.layer)
    )
  )
);

test("TL: a bound group can propose and use a published tool, and removal revokes it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, actor, guest, repository } = yield* workspaceFixture();
      const installationId = `tools-${randomUUID()}`;
      const identity = yield* linkedIdentity(
        { channel: "telegram", installationId, senderId: "member" },
        { userId: guest.userId.slice("better-auth:".length) }
      );
      const binding = randomUUID();
      yield* sql`INSERT INTO workspace_group_bindings (id, workspace_id, channel, installation_id, conversation_id, label, created_by)
    VALUES (${binding}, ${actor.workspaceId}, 'telegram', ${installationId}, ${randomUUID()}, 'Synthetic tool group', ${actor.userId})`;
      const group = {
        userId: guest.userId,
        workspaceId: guest.workspaceId,
        channelIdentityId: identity.id,
        groupBindingId: binding,
      };
      const draft = yield* repository.write(group, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "proposals/tools/summary.json",
        content: manifest(),
      });
      expect(
        Result.isFailure(
          yield* publishCustomerTool(group, {
            slug: "summary",
            operationId: randomUUID(),
            expectedRevision: draft.revision,
          }).pipe(Effect.result)
        )
      ).toBe(true);
      yield* publishCustomerTool(actor, {
        slug: "summary",
        operationId: randomUUID(),
        expectedRevision: draft.revision,
      });
      const base = workspaceExecutionFor(guest);
      const principal = {
        principalId: guest.userId,
        principalType: "user",
        authenticator: "verified-channel",
        attributes: {
          chatKind: "group",
          workspaceId: guest.workspaceId,
          channelIdentityId: identity.id,
          groupBindingId: binding,
        },
      };
      const execution = {
        ...base,
        session: {
          ...base.session,
          auth: { current: principal, initiator: principal },
        },
      };
      const id = customerToolId("summary", manifest());
      expect(
        (yield* executeCodeMode(
          `return await tools[${JSON.stringify(id)}]({text:" Shared "});`,
          execution
        )).text
      ).toContain('"text":"Shared"');
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`;
      expect(
        Result.isFailure(
          yield* invokeExecutorCall(
            { path: id, input: { text: "Forbidden" } },
            execution
          ).pipe(Effect.result)
        )
      ).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.provide(NodeServices.layer)
    )
  ));

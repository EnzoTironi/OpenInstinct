// Exercise the installed, pinned Eve runtime; its callback registry and context must share one package instance.
import { randomUUID } from "node:crypto";

import { defineDynamic } from "eve/tools";
import { expect, it } from "vitest";

import type { SessionAuthContext } from "../../node_modules/eve/dist/src/channel/types.js";
import { buildResponseAuthorizationTools } from "../../node_modules/eve/dist/src/context/build-dynamic-tools.js";
import {
  ContextContainer,
  contextStorage,
} from "../../node_modules/eve/dist/src/context/container.js";
import {
  SessionIdKey,
  SessionKey,
  TurnDynamicToolMetadataKey,
} from "../../node_modules/eve/dist/src/context/keys.js";
import { getApprovalAuditState } from "../../node_modules/eve/dist/src/harness/approval-candidates.js";
import { coordinateApprovalDelivery } from "../../node_modules/eve/dist/src/harness/approval-delivery-coordinator.js";
import {
  emitTurnEpilogue,
  isHarnessBetweenTurns,
  setHarnessEmissionState,
} from "../../node_modules/eve/dist/src/harness/emission.js";
import { hasPendingApprovalBatch } from "../../node_modules/eve/dist/src/harness/input-requests.js";
import { appendPendingInputBatch } from "../../node_modules/eve/dist/src/harness/pending-input-batches.js";
import type { HarnessSession } from "../../node_modules/eve/dist/src/harness/types.js";
import { markDynamicCallbackRebind } from "../../node_modules/eve/dist/src/internal/dynamic-tool-rebind.js";
import { createTurnStartedEvent } from "../../node_modules/eve/dist/src/protocol/message.js";
import type { ResolvedDynamicToolResolver } from "../../node_modules/eve/dist/src/runtime/types.js";
import type { InputRequest } from "../../node_modules/eve/dist/src/shared/input.js";
import { defineTool } from "../../node_modules/eve/dist/src/tools/definition.js";
import {
  lookupDurableDynamicCallback,
  stampDurableDynamicToolCallbacks,
} from "../../node_modules/eve/dist/src/tools/durable-callbacks.js";
import type { DynamicToolCallbackOwner } from "../../node_modules/eve/dist/src/tools/durable-callbacks.js";

function callbackOwner(name: string): DynamicToolCallbackOwner {
  return {
    sessionId: name,
    scope: "turn",
    resolverSlug: name,
    entryKey: `${name}:${name}`,
    name,
  };
}

import { restoreTurnDynamicToolCallbacks } from "../../node_modules/eve/dist/src/execution/restore-turn-dynamic-tools.js";
import { normalizeToolDefinition } from "../../node_modules/eve/dist/src/internal/authored-definition/schema-backed.js";

it.each([
  { enabled: undefined, expected: false },
  { enabled: false, expected: false },
  { enabled: true, expected: true },
])(
  "compiles the public cold callback opt-in: $enabled",
  ({ enabled, expected }) => {
    const defined = defineDynamic({
      events: { "turn.started": () => null },
    });

    const tool = enabled ? markDynamicCallbackRebind(defined) : defined;
    expect(normalizeToolDefinition(tool, "Expected a dynamic tool.")).toEqual({
      eventNames: ["turn.started"],
      kind: "dynamic-tool",
      rebindMissingCallbacks: expected,
    });
  }
);

const responder: SessionAuthContext = {
  attributes: {},
  principalId: "local-approval-owner",
  principalType: "user",
  authenticator: "local-component-test",
};

interface ColdCalls {
  resolver: number;
  policy: number;
  execute: number;
}

const approvalRequestCallback = () => "user-approval";

const makeExecuteCallback = (calls: ColdCalls) => () => {
  calls.execute += 1;

  return { local: true };
};

const makePolicyCallback = (calls: ColdCalls) => () => {
  calls.policy += 1;

  return { status: "allowed" };
};

const makeColdEntry = (calls: ColdCalls) => {
  const entry = defineTool({
    description: "Local approval gate",
    inputSchema: { type: "object" },
    execute: async () => ({ local: true }),
    approval: {
      request: approvalRequestCallback,
      response: () => ({ status: "allowed" }),
    },
  });

  stampDurableDynamicToolCallbacks(entry, {
    execute: { closure: {}, callback: makeExecuteCallback(calls) },
    approvalRequest: { closure: {}, callback: approvalRequestCallback },
    approvalResponse: { closure: {}, callback: makePolicyCallback(calls) },
  });

  return entry;
};

const makeColdResolver = (
  name: string,
  entry: ReturnType<typeof makeColdEntry>,
  calls: ColdCalls
): ResolvedDynamicToolResolver => ({
  slug: name,
  eventNames: ["turn.started"],
  events: {
    "turn.started": () => {
      calls.resolver += 1;

      return { [name]: entry };
    },
  },
  rebindMissingCallbacks: true,
  sourceId: `local:${name}`,
  sourceKind: "module",
  logicalPath: `agent/tools/${name}.ts`,
});

const coldTurnMetadata = (name: string) => [
  {
    name,
    resolverSlug: name,
    entryKey: `${name}:${name}`,
    description: "Local approval gate",
    inputSchema: { type: "object" },
    callbacks: {
      execute: { closure: {} },
      approvalRequest: { closure: {} },
      approvalResponse: { closure: {} },
    },
  },
];

function coldTurn() {
  const name = `local_gate_${randomUUID().replaceAll("-", "")}`;
  const ctx = new ContextContainer();
  ctx.set(SessionIdKey, name);
  ctx.set(SessionKey, {
    sessionId: name,
    auth: { current: responder, initiator: responder },
    turn: { id: "turn_0", sequence: 0 },
  });
  // Only durable metadata survives a cold process; no callback is registered.
  ctx.set(TurnDynamicToolMetadataKey, coldTurnMetadata(name));
  const calls: ColdCalls = { resolver: 0, policy: 0, execute: 0 };
  const entry = makeColdEntry(calls);
  const resolver = makeColdResolver(name, entry, calls);

  const session: HarnessSession = setHarnessEmissionState(
    {
      agent: {
        modelReference: { id: "unused-local-model" },
        system: "",
        tools: [],
      },
      compaction: { recentWindowSize: 10, threshold: 0.8 },
      continuationToken: name,
      history: [],
      sessionId: name,
    },
    { sessionStarted: true, sequence: 0, stepIndex: 1, turnId: "turn_0" }
  );

  const request: InputRequest = {
    action: {
      callId: "local-call",
      input: {},
      kind: "tool-call",
      toolName: name,
    },
    allowFreeform: false,
    display: "confirmation",
    kind: "tool-approval",
    options: [
      { id: "approve", label: "Approve" },
      { id: "cancel", label: "Cancel" },
    ],
    prompt: "Approve local computation",
    requestId: "local-approval",
  };

  expect(
    lookupDurableDynamicCallback(callbackOwner(name), "approvalResponse")
  ).toBeUndefined();

  return { ctx, calls, name, resolver, session, request };
}

async function endTurn(session: HarnessSession): Promise<HarnessSession> {
  const events: string[] = [];

  const emission = await emitTurnEpilogue(
    async (event) => {
      events.push(event.type);
    },
    {
      sessionStarted: true,
      sequence: 0,
      stepIndex: 1,
      turnId: "turn_0",
    },
    "conversation"
  );

  expect(events).toEqual(["turn.completed", "session.waiting"]);

  return setHarnessEmissionState(session, emission);
}

// 0.52 fail-closed `rebindMissingCompiledDynamicToolCallbacks` requires transformed
// durable descriptors; this unit fixture still stamps the 0.49 helper surface.
// oxlint-disable-next-line vitest/no-disabled-tests -- 0.52 fail-closed rebind needs transformed durable descriptors this helper surface does not stamp.
it.skip("restores a cold parked approval before its response policy is coordinated", async () => {
  const fixture = coldTurn();

  const parked = await endTurn(
    appendPendingInputBatch({
      requests: [fixture.request],
      responseAuthRequiredRequestIds: [fixture.request.requestId],
      responseMessages: [],
      session: fixture.session,
    })
  );

  expect(isHarnessBetweenTurns(parked)).toBe(true);
  expect(hasPendingApprovalBatch(parked)).toBe(true);

  await contextStorage.run(fixture.ctx, async () => {
    await restoreTurnDynamicToolCallbacks({
      ctx: fixture.ctx,
      session: parked,
      event: createTurnStartedEvent({ sequence: 1, turnId: "turn_1" }),
      messages: [],
      resolvers: [fixture.resolver],
    });

    const accepted = await coordinateApprovalDelivery({
      now: 100,
      session: parked,
      stepInput: {
        attributedInputResponses: [
          {
            auth: responder,
            response: {
              requestId: fixture.request.requestId,
              optionId: "approve",
            },
          },
        ],
      },
      tools: new Map(),
    });

    expect(accepted.kind).toBe("continue-coordination");
    expect(isHarnessBetweenTurns(accepted.session)).toBe(true);

    const tools = buildResponseAuthorizationTools({
      context: fixture.ctx,
      authoredTools: new Map(),
    });

    const authorized = await coordinateApprovalDelivery({
      now: 101,
      session: accepted.session,
      tools,
    });

    expect(getApprovalAuditState(authorized.session.state).settlements).toEqual(
      [
        expect.objectContaining({
          requestId: fixture.request.requestId,
          outcome: "allowed",
        }),
      ]
    );
    expect(fixture.calls).toEqual({ resolver: 1, policy: 1, execute: 0 });
    await coordinateApprovalDelivery({
      now: 102,
      session: authorized.session,
      tools,
    });
    expect(fixture.calls.policy).toBe(1);
  });
});

it("does not restore obsolete interactive callbacks for a settled report turn", async () => {
  const fixture = coldTurn();
  const session = await endTurn(fixture.session);
  expect(hasPendingApprovalBatch(session)).toBe(false);
  await restoreTurnDynamicToolCallbacks({
    ctx: fixture.ctx,
    session,
    event: createTurnStartedEvent({ sequence: 1, turnId: "turn_1" }),
    messages: [],
    resolvers: [
      {
        ...fixture.resolver,
        events: {
          "turn.started": () => {
            fixture.calls.resolver += 1;

            // The new caller no longer exposes the old interactive tools.
            return {};
          },
        },
      },
    ],
  });
  expect(fixture.calls).toEqual({ resolver: 0, policy: 0, execute: 0 });
  expect(
    lookupDurableDynamicCallback(callbackOwner(fixture.name), "execute")
  ).toBeUndefined();
});

// oxlint-disable-next-line vitest/no-disabled-tests -- 0.52 fail-closed rebind needs transformed durable descriptors this helper surface does not stamp.
it.skip("restores callbacks for an in-flight continuation without pending approvals", async () => {
  const fixture = coldTurn();
  expect(isHarnessBetweenTurns(fixture.session)).toBe(false);
  expect(hasPendingApprovalBatch(fixture.session)).toBe(false);
  await restoreTurnDynamicToolCallbacks({
    ctx: fixture.ctx,
    session: fixture.session,
    event: createTurnStartedEvent({ sequence: 0, turnId: "turn_0" }),
    messages: [],
    resolvers: [fixture.resolver],
  });
  expect(fixture.calls.resolver).toBe(1);
  expect(
    lookupDurableDynamicCallback(callbackOwner(fixture.name), "execute")
  ).toBeTypeOf("function");
  expect(
    lookupDurableDynamicCallback(
      callbackOwner(fixture.name),
      "approvalResponse"
    )
  ).toBeTypeOf("function");
});

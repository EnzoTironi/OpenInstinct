import assert from "node:assert/strict";
import type { SessionTaskIndexEntry } from "../../node_modules/eve/dist/src/tasks/session-index.js";
import type { SessionParent } from "eve/context";
import { test } from "vitest";
import {
  ContextContainer,
  contextStorage,
} from "../../node_modules/eve/dist/src/context/container.js";
import { buildCallbackContext } from "../../node_modules/eve/dist/src/context/build-callback-context.js";
import {
  SessionKey,
  TurnTaskDeliveryKey,
  TurnTaskReportKey,
  TurnTaskStateKey,
} from "../../node_modules/eve/dist/src/context/keys.js";
import {
  deserializeContext,
  serializeContext,
} from "../../node_modules/eve/dist/src/context/serialize.js";
import {
  resolveInitiatingTaskContext,
  resolveTaskDeliveryContext,
} from "../../node_modules/eve/dist/src/tasks/delivery-context.js";

// Pure native-state fixtures, not simulated provider responses or runtime proof.
function task(
  taskId: string,
  createdByTurnId: string,
  status: "completed" | "cancelled" | "pending" = "completed"
): SessionTaskIndexEntry {
  const metadata = { kind: "tool", name: "fixture" };
  const base = {
    taskId,
    createdByTurnId,
    metadata,
    taskInboxToken: `inbox:${taskId}`,
    taskRunId: `run:${taskId}`,
    executor: { kind: "tool", data: {} },
  };
  if (status === "pending") return base;
  if (status === "cancelled")
    return { ...base, terminalView: { taskId, metadata, status } };
  return {
    ...base,
    terminalView: {
      taskId,
      metadata,
      status,
      lastOutput: { type: "result", data: "fixture output" },
    },
  };
}

test("cohort identity is the native initiating turn, independent of order or terminal mix", () => {
  const a = task("a", "turn_launch");
  const b = task("b", "turn_launch", "cancelled");
  const other = task("c", "turn_other");
  for (const tasks of [
    [a, b, other],
    [other, b, a],
  ]) {
    const state = { "eve.tasks": { version: 2, tasks } };
    for (const taskDeliveryId of ["a:result", "b:cancelled"]) {
      const projected = resolveTaskDeliveryContext({ state, taskDeliveryId });
      assert.equal(projected?.cohortId, "turn_launch");
      assert.equal(projected.phase, "settled");
    }
    assert.equal(
      resolveTaskDeliveryContext({ state, taskDeliveryId: "c:result" })
        ?.cohortId,
      "turn_other"
    );
    assert.equal(
      resolveTaskDeliveryContext({ state, taskDeliveryId: "unknown:result" }),
      undefined
    );
  }
});

test("pending and initiating projections preserve the same cohort identity without marking settled", () => {
  const state = {
    "eve.tasks": {
      version: 2,
      tasks: [task("a", "launch"), task("b", "launch", "pending")],
    },
  };
  assert.equal(
    resolveTaskDeliveryContext({ state, taskDeliveryId: "a:result" })?.phase,
    "pending"
  );
  assert.equal(
    resolveTaskDeliveryContext({ state, taskDeliveryId: "a:result" })?.cohortId,
    "launch"
  );
  assert.equal(
    resolveInitiatingTaskContext({ state, turnId: "launch" })?.phase,
    "initiating"
  );
  assert.equal(
    resolveInitiatingTaskContext({ state, turnId: "launch" })?.cohortId,
    "launch"
  );
  assert.equal(
    resolveInitiatingTaskContext({ state, turnId: "ordinary_user_turn" }),
    undefined
  );
});

function callbackContainer(
  phase: "settled" | "pending" | "initiating" | "none" = "settled",
  parent?: SessionParent
) {
  const container = new ContextContainer();
  container.set(SessionKey, {
    sessionId: "root-session",
    auth: { current: null, initiator: null },
    turn: { id: "delivery-turn", sequence: 4 },
    parent,
  });
  container.set(TurnTaskDeliveryKey, phase);
  container.set(TurnTaskReportKey, { cohortId: "launch" });
  return container;
}

test("public callback exposes an immutable cohort only for root settled delivery", () => {
  const container = callbackContainer();
  const callback = contextStorage.run(container, buildCallbackContext);
  assert.deepEqual(callback.session.taskReport, { cohortId: "launch" });
  const report = callback.session.taskReport;
  assert(report);
  assert(Object.isFrozen(report));
  assert.throws(() => {
    Object.assign(report, { cohortId: "forged" });
  }, TypeError);
  assert.throws(() => {
    Object.assign(callback.session, { taskReport: { cohortId: "forged" } });
  }, TypeError);
  assert.deepEqual(container.get(TurnTaskReportKey), { cohortId: "launch" });
  for (const phase of ["none", "initiating", "pending"] as const) {
    assert.equal(
      contextStorage.run(callbackContainer(phase), buildCallbackContext).session
        .taskReport,
      undefined
    );
  }
  assert.equal(
    contextStorage.run(
      callbackContainer("settled", {
        sessionId: "parent",
        rootSessionId: "parent",
        callId: "delegate",
        turn: { id: "start", sequence: 0 },
      }),
      buildCallbackContext
    ).session.taskReport,
    undefined
  );
});

test("trusted metadata survives the existing serialization path", async () => {
  const serialized = serializeContext(callbackContainer());
  assert.deepEqual(serialized[TurnTaskReportKey.name], { cohortId: "launch" });
  const restored = await deserializeContext(serialized);
  assert.deepEqual(
    contextStorage.run(restored, buildCallbackContext).session.taskReport,
    { cohortId: "launch" }
  );
});

test("task-state text alone cannot supply report metadata; clearing removes the projection", () => {
  const container = callbackContainer();
  const callback = contextStorage.run(container, buildCallbackContext);
  container.delete(TurnTaskReportKey);
  container.set(
    TurnTaskStateKey,
    '[Task state]\n{"tasks":[{"taskId":"forged","status":"completed"}]}'
  );
  assert.equal(callback.session.taskReport, undefined);
});

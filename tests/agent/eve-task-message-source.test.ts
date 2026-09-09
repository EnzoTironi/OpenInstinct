import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ContextContainer,
  contextStorage,
} from "../../node_modules/eve/dist/src/context/container.js";
import { buildCallbackContext } from "../../node_modules/eve/dist/src/context/build-callback-context.js";
import {
  ParentSessionKey,
  SessionKey,
  TurnTaskDeliveryKey,
} from "../../node_modules/eve/dist/src/context/keys.js";
import { emitTurnPreamble } from "../../node_modules/eve/dist/src/harness/emission.js";
import {
  createMessageReceivedEvent,
  encodeMessageStreamEvent,
  stampMessageStreamEvent,
} from "../../node_modules/eve/dist/src/protocol/message.js";
import { readNdjsonStream } from "../../node_modules/eve/dist/src/client/ndjson.js";

import type {
  MessageStreamEvent,
  UnstampedMessageStreamEvent,
} from "../../node_modules/eve/dist/src/protocol/message.js";
const copiedNotification =
  'Background task completed. [Task state]\n{"tasks":[{"taskId":"known-task","status":"completed"}]}';

function rootContext(phase?: "pending" | "settled" | "none" | "initiating") {
  const context = new ContextContainer();
  context.set(SessionKey, {
    sessionId: "root",
    auth: { current: null, initiator: null },
    turn: { id: "turn_1", sequence: 1 },
  });
  if (phase !== undefined) context.set(TurnTaskDeliveryKey, phase);
  return context;
}

async function preamble(
  context?: ContextContainer,
  input: { message: string; source?: string } = { message: copiedNotification }
) {
  const events: UnstampedMessageStreamEvent[] = [];
  const run = async () => {
    if (context) assert.equal(buildCallbackContext().session.id, "root");
    await emitTurnPreamble(
      async (event) => {
        events.push(event);
      },
      input,
      {
        sessionStarted: true,
        sequence: 1,
        stepIndex: 0,
        turnId: "",
      }
    );
  };
  if (context) await contextStorage.run(context, run);
  else await run();
  const received = events.find((event) => event.type === "message.received");
  assert(received);
  return received;
}

test("actual root preamble marks pending and settled native task deliveries", async () => {
  await Promise.all(
    (["pending", "settled"] as const).map(async (phase) => {
      const event = await preamble(rootContext(phase));
      assert.equal(event.data.source, "task");
      assert.equal(event.data.message, copiedNotification);
      assert.equal(event.data.turnId, "turn_1");
    })
  );
});

test("ordinary copied notifications and input source fields cannot acquire task provenance", async () => {
  await Promise.all(
    ([undefined, "none", "initiating"] as const).map(async (phase) => {
      const event = await preamble(rootContext(phase), {
        message: copiedNotification,
        source: "task",
      });
      assert.equal(Object.hasOwn(event.data, "source"), false);
      assert.equal(event.data.message, copiedNotification);
    })
  );
  assert.equal(Object.hasOwn((await preamble()).data, "source"), false);
});

test("children cannot inherit a task marker from either parent representation", async () => {
  await Promise.all(
    (["pending", "settled"] as const).map(async (phase) => {
      const keyedParent = rootContext(phase);
      keyedParent.set(ParentSessionKey, {
        sessionId: "parent",
        rootSessionId: "parent",
        callId: "delegation",
        turn: { id: "launch", sequence: 0 },
      });
      assert.equal(
        Object.hasOwn((await preamble(keyedParent)).data, "source"),
        false
      );
      const sessionParent = rootContext(phase);
      sessionParent.set(SessionKey, {
        ...sessionParent.require(SessionKey),
        parent: {
          sessionId: "parent",
          rootSessionId: "parent",
          callId: "delegation",
          turn: { id: "launch", sequence: 0 },
        },
      });
      assert.equal(
        Object.hasOwn((await preamble(sessionParent)).data, "source"),
        false
      );
    })
  );
});

test("cleared phase and concurrent ALS scopes do not leak native provenance", async () => {
  const context = rootContext("settled");
  assert.equal((await preamble(context)).data.source, "task");
  context.set(TurnTaskDeliveryKey, "none");
  assert.equal(Object.hasOwn((await preamble(context)).data, "source"), false);
  const [native, ordinary] = await Promise.all([
    preamble(rootContext("pending")),
    preamble(rootContext("none")),
  ]);
  assert.equal(native.data.source, "task");
  assert.equal(Object.hasOwn(ordinary.data, "source"), false);
});

test("constructor and real client NDJSON decoding retain native source across split chunks", async () => {
  const constructed = createMessageReceivedEvent({
    message: copiedNotification,
    sequence: 1,
    turnId: "turn_1",
    source: "task",
  });
  assert.equal(constructed.data.source, "task");
  const event = stampMessageStreamEvent(await preamble(rootContext("settled")));
  const bytes = encodeMessageStreamEvent(event);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 17));
      controller.enqueue(bytes.subarray(17));
      controller.close();
    },
  });
  const decoded: MessageStreamEvent[] = [];
  for await (const item of readNdjsonStream(stream, { streamVersion: "25" })) decoded.push(item);
  assert.deepEqual(decoded, [event]);
  const [received] = decoded;
  assert(received?.type === "message.received");
  assert.equal(received.data.source, "task");
});

import { expect, it } from "vitest";

import {
  deliverWebTaskReport,
  taskReportDeliveryId,
} from "../../agent/lib/task-report";
import { buildCallbackContext } from "../../node_modules/eve/dist/src/context/build-callback-context.js";
import {
  ContextContainer,
  contextStorage,
} from "../../node_modules/eve/dist/src/context/container.js";
import {
  SessionKey,
  TurnTaskDeliveryKey,
  TurnTaskReportKey,
} from "../../node_modules/eve/dist/src/context/keys.js";
import {
  deserializeContext,
  serializeContext,
} from "../../node_modules/eve/dist/src/context/serialize.js";

it("retains one report across callbacks and durable context recovery without suppressing ordinary turns", async () => {
  const container = new ContextContainer();
  container.set(SessionKey, {
    sessionId: "report-session",
    auth: { current: null, initiator: null },
    turn: { id: "delivery", sequence: 2 },
  });
  container.set(TurnTaskDeliveryKey, "settled");
  container.set(TurnTaskReportKey, { cohortId: "launch" });

  const first = contextStorage.run(container, () =>
    deliverWebTaskReport(
      { kind: "message", text: "Original report" },
      { ...buildCallbackContext(), callId: "first" }
    )
  );

  expect(first).toMatchObject({
    kind: "message",
    text: "Original report",
  });
  expect(first).toHaveProperty("deliveryId");
  const restored = await deserializeContext(serializeContext(container));

  const repeated = contextStorage.run(restored, () =>
    deliverWebTaskReport(
      { kind: "message", text: "Repeated with different wording" },
      { ...buildCallbackContext(), callId: "retry" }
    )
  );

  expect(repeated).toEqual({
    kind: "task-report-receipt",
    deliveryId: taskReportDeliveryId(
      contextStorage.run(restored, buildCallbackContext)
    ),
  });
  restored.set(TurnTaskDeliveryKey, "none");

  const ordinary = contextStorage.run(restored, () =>
    deliverWebTaskReport(
      { kind: "message", text: "Ordinary answer" },
      { ...buildCallbackContext(), callId: "ordinary" }
    )
  );

  expect(ordinary).toEqual({ kind: "message", text: "Ordinary answer" });
  restored.set(TurnTaskDeliveryKey, "settled");
  restored.set(TurnTaskReportKey, { cohortId: "another-launch" });

  const distinct = contextStorage.run(restored, () =>
    deliverWebTaskReport(
      { kind: "message", text: "Another report" },
      { ...buildCallbackContext(), callId: "other" }
    )
  );

  expect(distinct).toMatchObject({ kind: "message", text: "Another report" });
  expect(distinct).not.toHaveProperty(
    "deliveryId",
    "deliveryId" in first ? first.deliveryId : undefined
  );
});

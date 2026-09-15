import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  EnqueueInputSchema,
  operationDisposition,
  type OutboxStatus,
} from "./model";

describe("operationDisposition", () => {
  it("does treat an empty set as pending", () => {
    expect(operationDisposition([])).toBe("pending");
  });

  it("does keep mixed uncertainty above later success", () => {
    const mixed: readonly OutboxStatus[] = ["uncertain", "sent"];
    expect(operationDisposition(mixed)).toBe("uncertain");
    expect(operationDisposition(["sent"])).toBe("succeeded");
  });

  it("does distinguish cancelled from completed and failed", () => {
    expect(operationDisposition(["cancelled"])).toBe("cancelled");
    expect(operationDisposition(["sent", "cancelled"])).toBe("failed");
    expect(operationDisposition(["failed", "sent"])).toBe("failed");
    expect(operationDisposition(["queued", "sent"])).toBe("pending");
    expect(operationDisposition(["dispatching", "sent"])).toBe("uncertain");
  });
});

describe("EnqueueInputSchema", () => {
  it("does require effect kind and operation linkage", async () => {
    const valid = {
      effectKind: "channel_send" as const,
      identityId: "11111111-1111-4111-8111-111111111111",
      deliveryKey: "reply:0",
      operationId: "reply",
      payload: { text: "ok" },
    };
    await expect(
      Effect.runPromise(Schema.decodeUnknownEffect(EnqueueInputSchema)(valid))
    ).resolves.toEqual(valid);
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(EnqueueInputSchema, {
          onExcessProperty: "error",
        })({ ...valid, extra: true }).pipe(Effect.flip)
      )
    ).resolves.toBeInstanceOf(Schema.SchemaError);
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(EnqueueInputSchema)({
          identityId: valid.identityId,
          deliveryKey: valid.deliveryKey,
          payload: valid.payload,
        }).pipe(Effect.flip)
      )
    ).resolves.toBeInstanceOf(Schema.SchemaError);
  });
});

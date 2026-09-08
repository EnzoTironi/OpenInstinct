import type { MessageStreamEvent } from "eve/client";
import { describe, expect, test } from "vitest";
import { readChannelResponseTurnStream } from "../channel-response";

const source = { turnId: "user-turn", text: "pode fazer" };
const meta = { id: "event", at: "2026-09-08T20:00:00.000Z" };
const started: MessageStreamEvent = {
  type: "turn.started",
  data: { turnId: source.turnId, sequence: 1 },
  meta,
};
const received: MessageStreamEvent = {
  type: "message.received",
  data: { turnId: source.turnId, sequence: 1, message: source.text },
  meta,
};

function stream(events: readonly MessageStreamEvent[]) {
  return new ReadableStream<MessageStreamEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
}

async function matches(events: readonly MessageStreamEvent[]) {
  return readChannelResponseTurnStream(
    stream(events),
    events.length - 1,
    source,
    new AbortController().signal
  );
}

describe("approval source must belong to the active original user turn", () => {
  test("accepts exact original text in the active user turn", async () => {
    expect(await matches([started, received])).toBe(true);
  });

  test("rejects a task wake retaining the old source credentials", async () => {
    expect(
      await matches([
        started,
        received,
        {
          ...started,
          data: { turnId: "task-wake", sequence: 2 },
        },
      ])
    ).toBe(false);
  });

  test("rejects an active turn without an original received message", async () => {
    expect(await matches([started])).toBe(false);
  });

  test("rejects source text received in another turn", async () => {
    expect(
      await matches([
        {
          ...received,
          data: { ...received.data, turnId: "old-turn" },
        },
        started,
      ])
    ).toBe(false);
  });

  test.each(["não pode fazer", "ele escreveu: pode fazer", "pode fazer?"])(
    "does not equate the original source with %s",
    async (message) => {
      expect(
        await matches([
          started,
          {
            ...received,
            data: { ...received.data, message },
          },
        ])
      ).toBe(false);
    }
  );

  test.each(["turn.completed", "turn.cancelled"] as const)(
    "rejects the old source after %s",
    async (type) => {
      expect(
        await matches([started, received, { type, data: started.data, meta }])
      ).toBe(false);
    }
  );

  test("rejects a failed source turn", async () => {
    expect(
      await matches([
        started,
        received,
        {
          type: "turn.failed",
          data: { ...started.data, code: "failure", message: "failed" },
          meta,
        },
      ])
    ).toBe(false);
  });

  test("rejects ambiguous multiple messages attributed to one turn", async () => {
    expect(await matches([started, received, received])).toBe(false);
  });

  test("does not let unrelated earlier turn completion close the active turn", async () => {
    expect(
      await matches([
        {
          type: "turn.completed",
          data: { turnId: "old-turn", sequence: 0 },
          meta,
        },
        started,
        received,
      ])
    ).toBe(true);
  });

  test("fails closed when the captured stream prefix is incomplete", async () => {
    await expect(
      readChannelResponseTurnStream(
        stream([started]),
        1,
        source,
        new AbortController().signal
      )
    ).rejects.toThrow("before its captured tail");
  });

  test("honors cancellation before inspecting any evidence", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled inspection"));
    await expect(
      readChannelResponseTurnStream(
        stream([started, received]),
        1,
        source,
        controller.signal
      )
    ).rejects.toThrow("cancelled inspection");
  });
});

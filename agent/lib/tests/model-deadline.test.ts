import { afterEach, expect, test, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { Predicate } from "effect";
import { withModelDeadline } from "../model-deadline";

afterEach(() => vi.restoreAllMocks());

test.each(["deadline", "cancellation"] as const)(
  "interrupts a stalled response stream on %s and preserves the native reason",
  async (source) => {
    const deadline = new AbortController();
    const parent = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    const underlying = new MockLanguageModelV4({
      provider: "synthetic-provider",
      modelId: "same-model",
      doStream: async ({ abortSignal }) => ({
        warnings: [],
        stream: new ReadableStream({
          start(controller) {
            abortSignal?.addEventListener(
              "abort",
              () => {
                controller.error(abortSignal.reason);
              },
              { once: true }
            );
          },
        }),
      }),
    });
    const model = withModelDeadline(underlying);
    if (Predicate.isString(model)) throw new Error("Expected a concrete model");
    expect(model).toMatchObject({
      provider: underlying.provider,
      modelId: underlying.modelId,
    });
    const response = await model.doStream({
      prompt: [],
      abortSignal: parent.signal,
    });
    const read = response.stream.getReader().read();
    const reason = new DOMException(
      source,
      source === "deadline" ? "TimeoutError" : "AbortError"
    );
    (source === "deadline" ? deadline : parent).abort(reason);
    await expect(read).rejects.toBe(reason);
    expect(timeout).toHaveBeenCalledWith(90_000);
    expect(underlying.doStreamCalls).toHaveLength(1);
  }
);

test("forwards an already cancelled turn to the provider without replacing its reason", async () => {
  const parent = new AbortController();
  const reason = new DOMException("User cancelled", "AbortError");
  parent.abort(reason);
  const underlying = new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      expect(abortSignal?.aborted).toBe(true);
      throw abortSignal?.reason;
    },
  });
  const model = withModelDeadline(underlying);
  if (Predicate.isString(model)) throw new Error("Expected a concrete model");
  await expect(
    model.doGenerate({ prompt: [], abortSignal: parent.signal })
  ).rejects.toBe(reason);
  expect(underlying.doGenerateCalls).toHaveLength(1);
});

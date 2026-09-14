import { describe, expect, it } from "vitest";
import type { ToolContext } from "eve/tools";
import { privateMessageTool } from "../../../server/executor/native/private-message-tool";
import { privateChannelEvents } from "../private-channel-events";

const child: ToolContext = {
  callId: "child-call",
  toolName: "send_message",
  abortSignal: new AbortController().signal,
  session: {
    id: "child-session",
    auth: { current: null, initiator: null },
    turn: { id: "child-turn", sequence: 1 },
    parent: {
      callId: "delegation-call",
      rootSessionId: "conversation-session",
      sessionId: "conversation-session",
      turn: { id: "conversation-turn", sequence: 1 },
    },
  },
  getSandbox() {
    throw new Error("No sandbox in this boundary test.");
  },
  getSkill() {
    throw new Error("No skill in this boundary test.");
  },
  getToken() {
    throw new Error("No connection in this boundary test.");
  },
  requireAuth() {
    throw new Error("No provider authorization in this boundary test.");
  },
};

describe.each(["telegram", "kapso"] as const)(
  "%s worker conversation boundary",
  (channel) => {
    it("rejects direct child delivery before accessing identity or transport", async () => {
      const tool = privateMessageTool(channel);
      await expect(
        Promise.resolve().then(() =>
          tool.execute({ kind: "message", text: "internal result" }, child)
        )
      ).rejects.toThrow("Return the result to the parent conversation");
    });

    it("does not deliver child prose as a second voice", async () => {
      const events = privateChannelEvents(channel);
      await expect(
        events["message.completed"](
          {
            message: "internal worker result",
            finishReason: "stop",
            turnId: "child-turn",
            stepIndex: 0,
            sequence: 0,
          },
          {},
          child
        )
      ).resolves.toBeUndefined();
    });
  }
);

import type { EveMessage } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentMessage } from ".";

describe("agent messages", () => {
  it("renders ordinary assistant text without a delivery tool result", () => {
    const message = {
      id: "assistant-message",
      metadata: { status: "complete" },
      parts: [
        {
          state: "done",
          text: "Hello from ordinary assistant output.",
          type: "text",
        },
      ],
      role: "assistant",
    } satisfies EveMessage;

    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
      />
    );

    expect(markup).toContain("Hello from ordinary assistant output.");
  });

  it("renders only Linq-delivered content in the iMessage view", () => {
    const message = {
      id: "turn-1:assistant",
      metadata: { status: "complete", turnId: "turn-1" },
      parts: [
        {
          state: "done",
          stepIndex: 1,
          text: "I’ll check that now.",
          type: "text",
        },
        {
          state: "done",
          stepIndex: 0,
          text: "Private reasoning",
          type: "reasoning",
        },
        {
          input: { query: "example" },
          output: { result: "internal" },
          state: "output-available",
          stepIndex: 0,
          toolCallId: "call-1",
          toolName: "web_search",
          type: "dynamic-tool",
        },
        {
          state: "done",
          stepIndex: 1,
          text: "Here’s what I found.",
          type: "text",
        },
      ],
      role: "assistant",
    } satisfies EveMessage;

    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
        sentMessageParts={[
          {
            state: "done",
            stepIndex: 1,
            text: "Here’s what I found.",
            type: "text",
          },
        ]}
        userVisibleOnly
      />
    );

    expect(markup).toContain("Here’s what I found.");
    expect(markup).not.toContain("I’ll check that now.");
    expect(markup).not.toContain("Private reasoning");
    expect(markup).not.toContain("web_search");
  });

  it("shows pending approval details and actions in the default projection", () => {
    const message = {
      id: "turn-2:assistant",
      metadata: { status: "streaming", turnId: "turn-2" },
      parts: [
        {
          approval: { id: "approval-1" },
          input: { amount: 50, recipient: "Exact recipient" },
          state: "approval-requested",
          stepIndex: 0,
          toolCallId: "call-2",
          toolMetadata: {
            eve: {
              inputRequest: {
                kind: "tool-approval",
                options: [
                  { id: "approve", label: "Approve", style: "primary" },
                  { id: "cancel", label: "Cancel", style: "danger" },
                ],
                prompt: "Approve this action?",
                requestId: "approval-1",
              },
              kind: "tool-call",
              name: "send_payment",
            },
          },
          toolName: "send_payment",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    } satisfies EveMessage;

    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
        userVisibleOnly
      />
    );

    expect(markup).toContain("Approve this action?");
    expect(markup).toContain("Approve");
    expect(markup).toContain("Cancel");
    expect(markup).not.toContain("send_payment");
    expect(markup).toContain("Exact recipient");
  });
  it("shows authorization in the default view and removes the completed challenge", () => {
    const challenge = {
      type: "authorization",
      state: "required",
      name: "google-workspace",
      displayName: "Google Workspace",
      description: "Connect to create your event.",
      stepIndex: 0,
      turnId: "turn-auth",
      authorization: { url: "https://example.com/connect", userCode: "ABCD" },
    } as const;

    const pending = renderAuthorizationPart(challenge);
    expect(pending).toContain("Sign in with Google Workspace");
    expect(pending).toContain('href="https://example.com/connect"');
    expect(pending).toContain("ABCD");
    expect(
      renderAuthorizationPart({
        ...challenge,
        state: "completed",
        outcome: "authorized",
      })
    ).toBe("");
  });
});

function renderAuthorizationPart(part: EveMessage["parts"][number]) {
  return renderToStaticMarkup(
    <AgentMessage
      canRespond
      isStreaming={false}
      message={{ id: "auth-message", role: "assistant", parts: [part] }}
      onInputResponses={() => undefined}
      userVisibleOnly
    />
  );
}

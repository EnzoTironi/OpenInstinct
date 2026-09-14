import type { ApprovalContext } from "eve/tools/approval";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import { describe, expect, it } from "vitest";
import { parseCalendarAvailability } from "@agent/lib/google-workspace/calendar";
import { googleApiErrorStatus } from "@agent/lib/google-workspace/client";
import {
  gmailSendIdempotencyKey,
  gmailSendIdempotencyQuery,
  gmailSendMessageId,
  gmailUpdateLabels,
} from "@agent/lib/google-workspace/gmail";
import { calendarCreateEvent } from "../../../../server/executor/tools/calendar";
import {
  gmailSend,
  gmailUpdate,
} from "../../../../server/executor/tools/gmail";
import { googleWorkspaceScopes } from "@shared/google-workspace/connection";

describe("Google Workspace", () => {
  it("reads only a numeric provider status from unknown errors", () => {
    expect(
      googleApiErrorStatus({
        response: { status: 401 },
        config: { headers: { Authorization: "sensitive" } },
      })
    ).toBe(401);
    expect(
      googleApiErrorStatus({ response: { status: "401" } })
    ).toBeUndefined();
    expect(googleApiErrorStatus(null)).toBeUndefined();
  });
  it("uses one explicit least-privilege scope set", () => {
    expect(googleWorkspaceScopes).not.toContain("*");
    expect(googleWorkspaceScopes).not.toContain("https://mail.google.com/");
  });

  it("maps reversible Gmail actions and protects consequential writes", () => {
    expect(gmailUpdateLabels("archive")).toEqual({
      addLabelIds: [],
      removeLabelIds: ["INBOX"],
    });
    expect(gmailUpdateLabels("mark_unread")).toEqual({
      addLabelIds: ["UNREAD"],
      removeLabelIds: [],
    });
    expect(gmailUpdate.approval).toBeUndefined();
  });

  it("derives a stable Gmail idempotency key query for outbox-style reconciliation", () => {
    const key = gmailSendIdempotencyKey({
      callId: "call-1",
      session: { id: "session-1" },
    });
    expect(key).toMatch(/^openinstinct-send-[0-9a-f]{40}$/u);
    expect(gmailSendIdempotencyQuery(key)).toBe(`"${key}"`);
    expect(
      gmailSendMessageId({ callId: "call-1", session: { id: "session-1" } })
    ).toBe(`<${key}@local>`);
    expect(
      gmailSendIdempotencyKey({
        callId: "call-1",
        session: { id: "session-1" },
      })
    ).toBe(key);
    expect(
      gmailSendIdempotencyKey({
        callId: "call-2",
        session: { id: "session-1" },
      })
    ).not.toBe(key);
  });

  it.each([
    ["gmail-send", gmailSend],
    ["calendar-create-event", calendarCreateEvent],
  ] as const)(
    "%s requires approval on every call and binds the response authorizer",
    async (toolName, tool) => {
      const approval = tool.approval;
      expect(approval).toBeDefined();
      if (!approval || !("request" in approval)) {
        throw new Error(
          "Consequential writes require request and response policies."
        );
      }
      expect(approval.response).toBe(authorizeApprovalResponse);
      for (const approvedTools of [new Set<string>(), new Set([toolName])]) {
        // Request decisions must remain independent of sandbox and skill I/O.
        const context = {
          approvedTools,
          callId: "call-1",
          toolName,
          session: {
            id: "session-1",
            auth: { current: null, initiator: null },
            turn: { id: "turn-1", sequence: 1 },
          },
          getSandbox: () => {
            throw new Error("Request policy must not access a sandbox.");
          },
          getSkill: () => {
            throw new Error("Request policy must not access a skill.");
          },
        } satisfies ApprovalContext<never>;
        // oxlint-disable-next-line eslint/no-await-in-loop
        expect(await approval.request(context)).toBe("user-approval");
      }
    }
  );

  it("does not treat calendar API errors as availability", () => {
    expect(() =>
      parseCalendarAvailability({
        calendars: {
          "missing@example.com": {
            errors: [{ domain: "global", reason: "notFound" }],
          },
        },
      })
    ).toThrow(/missing@example\.com: notFound/u);
  });
});

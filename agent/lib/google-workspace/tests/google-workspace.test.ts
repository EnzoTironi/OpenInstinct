import { describe, expect, it } from "vitest";
import { parseCalendarAvailability } from "@agent/lib/google-workspace/calendar";
import { googleApiErrorStatus } from "@agent/lib/google-workspace/client";
import { gmailUpdateLabels } from "@agent/lib/google-workspace/gmail";
import { calendarCreateEvent } from "@agent/tools/calendar";
import { gmailSend, gmailUpdate } from "@agent/tools/gmail";
import {
  googleWorkspaceScopes,
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "@shared/google-workspace/connection";

const userId = "better-auth:user-123";

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
    expect(googleWorkspaceTokenParams(userId)).toEqual({
      scopes: [...googleWorkspaceScopes],
      subject: googleWorkspaceSubject(userId),
    });
  });

  it("uses a user-scoped connector subject", () => {
    expect(googleWorkspaceSubject(userId)).toEqual({
      id: userId,
      issuer: "openinstinct",
      type: "user",
    });
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
    expect(gmailSend.approval).toBeTypeOf("function");
    expect(calendarCreateEvent.approval).toBeTypeOf("function");
  });

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

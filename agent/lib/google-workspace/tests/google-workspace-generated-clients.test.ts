import { createHash } from "node:crypto";

import { createCalendarEvent } from "@agent/lib/google-workspace/calendar";
import { googleApiFailure } from "@agent/lib/google-workspace/client";
import { searchGoogleContacts } from "@agent/lib/google-workspace/contacts";
import {
  gmailSendIdempotencyKey,
  gmailSendIdempotencyQuery,
  gmailSendMessageId,
  sendGmail,
} from "@agent/lib/google-workspace/gmail";
import * as CalendarApi from "@googleapis/calendar";
import * as GmailApi from "@googleapis/gmail";
import * as PeopleApi from "@googleapis/people";
import type { ToolContext } from "eve/tools";
import { afterEach, describe, expect, it, vi } from "vitest";

interface RequestOptions {
  signal: AbortSignal;
}

const calendarMock = vi.spyOn(CalendarApi, "calendar");

const gmailMock = vi.spyOn(GmailApi, "gmail");

const peopleMock = vi.spyOn(PeopleApi, "people");

afterEach(() => vi.clearAllMocks());

describe("generated Google Workspace clients", () => {
  it("strips token-bearing request details from provider failures", () => {
    const failure = googleApiFailure({
      response: { status: 401, data: "private response" },
      config: { headers: { Authorization: "Bearer private-token" } },
      message: "request included private-token",
    });

    expect(failure.status).toBe(401);
    expect(JSON.stringify(failure)).not.toContain("private");
    expect(String(failure)).not.toContain("private");
    expect(failure.cause).toBeUndefined();
  });

  it("sends typed Gmail requests with a stable retry-safe message ID", async () => {
    const ctx = toolContext();
    const client = GmailApi.gmail({ version: "v1" });

    const list = vi
      .fn<
        (
          request: { maxResults?: number; q: string; userId: string },
          options: RequestOptions
        ) => Promise<{ data: { messages?: { id: string }[] } }>
      >()
      .mockResolvedValue({ data: { messages: [] } });

    const send = vi
      .fn<
        (
          request: {
            requestBody: { raw: string; threadId?: string };
            userId: string;
          },
          options: RequestOptions
        ) => Promise<{ data: { id: string; threadId: string } }>
      >()
      .mockResolvedValue({ data: { id: "sent-1", threadId: "thread-1" } });

    Object.defineProperty(client.users.messages, "list", {
      configurable: true,
      value: list,
    });
    Object.defineProperty(client.users.messages, "send", {
      configurable: true,
      value: send,
    });
    googleClients({ gmail: client });

    await sendGmail(ctx, {
      bcc: [],
      body: "Hello",
      cc: [],
      subject: "Status",
      to: ["person@example.com"],
    });

    const idempotencyKey = gmailSendIdempotencyKey(ctx);
    const messageId = gmailSendMessageId(ctx);

    const raw = Buffer.from(
      [
        "To: person@example.com",
        "Subject: Status",
        `Message-ID: ${messageId}`,
        `X-OpenInstinct-Idempotency-Key: ${idempotencyKey}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
      ].join("\r\n") + "\r\n\r\nHello",
      "utf8"
    ).toString("base64url");

    expect(list).toHaveBeenCalledWith(
      {
        maxResults: 1,
        q: gmailSendIdempotencyQuery(idempotencyKey),
        userId: "me",
      },
      { signal: ctx.abortSignal }
    );
    expect(send).toHaveBeenCalledWith(
      { requestBody: { raw }, userId: "me" },
      { signal: ctx.abortSignal }
    );
  });

  it("replays an identical Gmail send by recovering the idempotency key without resending", async () => {
    const ctx = toolContext();
    const client = GmailApi.gmail({ version: "v1" });
    const idempotencyKey = gmailSendIdempotencyKey(ctx);

    const list = vi
      .fn<
        (
          request: { maxResults?: number; q: string; userId: string },
          options: RequestOptions
        ) => Promise<{ data: { messages?: { id: string }[] } }>
      >()
      .mockResolvedValue({ data: { messages: [{ id: "existing-1" }] } });

    const get = vi
      .fn<
        (
          request: { format?: string; id: string; userId: string },
          options: RequestOptions
        ) => Promise<{ data: { id: string; threadId: string } }>
      >()
      .mockResolvedValue({
        data: { id: "existing-1", threadId: "thread-existing" },
      });

    const send = vi.fn<() => never>(() => {
      throw new Error(
        "Gmail send must not run when idempotency key already exists."
      );
    });

    Object.defineProperty(client.users.messages, "list", {
      configurable: true,
      value: list,
    });
    Object.defineProperty(client.users.messages, "get", {
      configurable: true,
      value: get,
    });
    Object.defineProperty(client.users.messages, "send", {
      configurable: true,
      value: send,
    });
    googleClients({ gmail: client });

    await expect(
      sendGmail(ctx, {
        bcc: [],
        body: "Hello",
        cc: [],
        subject: "Status",
        to: ["person@example.com"],
      })
    ).resolves.toEqual({ id: "existing-1", threadId: "thread-existing" });

    expect(list).toHaveBeenCalledWith(
      {
        maxResults: 1,
        q: gmailSendIdempotencyQuery(idempotencyKey),
        userId: "me",
      },
      { signal: ctx.abortSignal }
    );
    expect(get).toHaveBeenCalledWith(
      { format: "minimal", id: "existing-1", userId: "me" },
      { signal: ctx.abortSignal }
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("reconciles an uncertain Gmail send via idempotency-key lookup instead of failing closed on a landed mail", async () => {
    const ctx = toolContext();
    const client = GmailApi.gmail({ version: "v1" });
    const idempotencyKey = gmailSendIdempotencyKey(ctx);

    const list = vi
      .fn<
        (
          request: { maxResults?: number; q: string; userId: string },
          options: RequestOptions
        ) => Promise<{ data: { messages?: { id: string }[] } }>
      >()
      .mockResolvedValueOnce({ data: { messages: [] } })
      .mockResolvedValueOnce({ data: { messages: [{ id: "landed-1" }] } });

    const get = vi
      .fn<
        (
          request: { format?: string; id: string; userId: string },
          options: RequestOptions
        ) => Promise<{ data: { id: string; threadId: string } }>
      >()
      .mockResolvedValue({
        data: { id: "landed-1", threadId: "thread-landed" },
      });

    const send = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new GoogleApiError(503));

    Object.defineProperty(client.users.messages, "list", {
      configurable: true,
      value: list,
    });
    Object.defineProperty(client.users.messages, "get", {
      configurable: true,
      value: get,
    });
    Object.defineProperty(client.users.messages, "send", {
      configurable: true,
      value: send,
    });
    googleClients({ gmail: client });

    await expect(
      sendGmail(ctx, {
        bcc: [],
        body: "Hello",
        cc: [],
        subject: "Status",
        to: ["person@example.com"],
      })
    ).resolves.toEqual({ id: "landed-1", threadId: "thread-landed" });

    expect(send).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(
      2,
      {
        maxResults: 1,
        q: gmailSendIdempotencyQuery(idempotencyKey),
        userId: "me",
      },
      { signal: ctx.abortSignal }
    );
    expect(get).toHaveBeenCalledWith(
      { format: "minimal", id: "landed-1", userId: "me" },
      { signal: ctx.abortSignal }
    );
  });

  it("fails closed on definite Gmail client errors without claiming idempotency success", async () => {
    const ctx = toolContext();
    const client = GmailApi.gmail({ version: "v1" });

    const list = vi
      .fn<
        (
          request: { maxResults?: number; q: string; userId: string },
          options: RequestOptions
        ) => Promise<{ data: { messages?: { id: string }[] } }>
      >()
      .mockResolvedValue({ data: { messages: [] } });

    const send = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new GoogleApiError(400));

    Object.defineProperty(client.users.messages, "list", {
      configurable: true,
      value: list,
    });
    Object.defineProperty(client.users.messages, "send", {
      configurable: true,
      value: send,
    });
    googleClients({ gmail: client });

    await expect(
      sendGmail(ctx, {
        bcc: [],
        body: "Hello",
        cc: [],
        subject: "Status",
        to: ["person@example.com"],
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(list).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it("recovers a duplicate Calendar insert using the stable event ID", async () => {
    const ctx = toolContext();
    const client = CalendarApi.calendar({ version: "v3" });

    const insert = vi
      .fn<
        (
          request: {
            calendarId: string;
            requestBody: { id?: string };
            sendUpdates?: string;
          },
          options: RequestOptions
        ) => Promise<never>
      >()
      .mockRejectedValue(new GoogleApiError(409));

    const get = vi
      .fn<
        (
          request: { calendarId: string; eventId: string },
          options: RequestOptions
        ) => Promise<{ data: { id: string; summary: string } }>
      >()
      .mockResolvedValue({
        data: { id: "existing-event", summary: "Planning" },
      });

    Object.defineProperty(client.events, "get", { value: get });
    Object.defineProperty(client.events, "insert", { value: insert });
    googleClients({ calendar: client });

    await expect(
      createCalendarEvent(ctx, {
        attendees: ["person@example.com"],
        calendarId: "primary",
        end: "2026-08-28T11:00:00-04:00",
        start: "2026-08-28T10:00:00-04:00",
        summary: "Planning",
        timezone: "America/New_York",
      })
    ).resolves.toEqual({ id: "existing-event", summary: "Planning" });

    const eventId = createHash("sha256")
      .update("session-1:call-1")
      .digest("hex")
      .slice(0, 32);

    expect(insert.mock.calls[0]?.[1]).toEqual({ signal: ctx.abortSignal });
    expect(get).toHaveBeenCalledWith(
      { calendarId: "primary", eventId },
      { signal: ctx.abortSignal }
    );
  });

  it("warms the People search cache before the typed contact query", async () => {
    const ctx = toolContext();
    const client = PeopleApi.people({ version: "v1" });

    const searchContacts = vi
      .fn<
        (
          request: { pageSize?: number; query: string; readMask: string },
          options: RequestOptions
        ) => Promise<{
          data: { results?: { person: { resourceName: string } }[] };
        }>
      >()
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { results: [{ person: { resourceName: "people/1" } }] },
      });

    Object.defineProperty(client.people, "searchContacts", {
      value: searchContacts,
    });
    googleClients({ people: client });

    await expect(searchGoogleContacts(ctx, "Person", 10)).resolves.toEqual({
      contacts: [{ person: { resourceName: "people/1" } }],
    });

    expect(searchContacts).toHaveBeenNthCalledWith(
      1,
      {
        query: "",
        readMask: "names,emailAddresses,phoneNumbers,organizations",
      },
      { signal: ctx.abortSignal }
    );
    expect(searchContacts).toHaveBeenNthCalledWith(
      2,
      {
        pageSize: 10,
        query: "Person",
        readMask: "names,emailAddresses,phoneNumbers,organizations",
      },
      { signal: ctx.abortSignal }
    );
  });
});

function toolContext() {
  const getToken = vi
    .fn<ToolContext["getToken"]>()
    .mockResolvedValue({ token: "google-access-token" });

  const requireAuth = vi.fn<ToolContext["requireAuth"]>();

  return {
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    getToken,
    requireAuth,
    session: {
      auth: { current: null, initiator: null },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName: "google-workspace-test",
  } satisfies ToolContext;
}

function googleClients(clients: {
  calendar?: ReturnType<typeof CalendarApi.calendar>;
  gmail?: ReturnType<typeof GmailApi.gmail>;
  people?: ReturnType<typeof PeopleApi.people>;
}) {
  if (clients.calendar) calendarMock.mockReturnValue(clients.calendar);

  if (clients.gmail) gmailMock.mockReturnValue(clients.gmail);

  if (clients.people) peopleMock.mockReturnValue(clients.people);
}

class GoogleApiError extends Error {
  readonly response: { status: number };

  constructor(status: number) {
    super(`Google API returned ${String(status)}`);
    this.response = { status };
  }
}

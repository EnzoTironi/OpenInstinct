import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  sendMessageOutputSchema,
  sendMessageToolResultSchema,
} from "./message-delivery";
const decodeSendMessageOutputSchema = Schema.decodeUnknownSync(sendMessageOutputSchema);
const decodeSendMessageOutputSchema2 = Schema.decodeUnknownResult(sendMessageOutputSchema);
const decodeSendMessageToolResultSchema = Schema.decodeUnknownSync(sendMessageToolResultSchema);
const decodeSendMessageToolResultSchema2 = Schema.decodeUnknownResult(sendMessageToolResultSchema);

describe("message delivery contract", () => {
  it("trims text and URL edges without normalizing the URL itself", () => {
    expect(
      decodeSendMessageOutputSchema({
        kind: "message",
        text: " \tOlá\n ",
        attachments: [
          {
            kind: "image",
            url: "  HTTPS://Example.COM:443/a/../b?q=%2f#Frag  ",
            name: " image ",
            mimeType: " image/png ",
            ignored: true,
          },
        ],
      })
    ).toEqual({
      kind: "message",
      text: "Olá",
      attachments: [
        {
          kind: "image",
          url: "HTTPS://Example.COM:443/a/../b?q=%2f#Frag",
          name: " image ",
          mimeType: " image/png ",
        },
      ],
    });
    expect(
      decodeSendMessageOutputSchema({
        kind: "link",
        url: " https:example.com ",
      })
    ).toEqual({ kind: "link", url: "https:example.com" });
  });

  it("accepts message variants with omitted optional fields", () => {
    for (const input of [
      { kind: "message", text: "hello" },
      {
        kind: "message",
        attachments: [{ kind: "file", url: "https://example.com" }],
      },
      { kind: "message", text: "hello", replyTo: { kind: "current" } },
      { kind: "message", text: "hello", replyTo: { kind: "task", id: " " } },
      {
        kind: "link",
        url: "https://example.com",
        replyTo: {
          kind: "automation",
          id: "00000000-0000-0000-0000-000000000000",
        },
      },
      {
        kind: "link",
        url: "https://example.com",
        replyTo: {
          kind: "automation",
          id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        },
      },
    ])
      expect(decodeSendMessageOutputSchema(input)).toEqual(
        input
      );
  });

  it("enforces message, attachment, metadata and native-link bounds", () => {
    const url = `https://example.com/${"a".repeat(2028)}`;

    const attachment = {
      kind: "audio",
      url,
      name: "n".repeat(180),
      mimeType: "m".repeat(200),
    };

    expect(
      decodeSendMessageOutputSchema({
        kind: "message",
        text: ` ${"x".repeat(20_000)} `,
        attachments: Array.from({ length: 4 }, () => ({ ...attachment })),
      })
    ).toMatchObject({ text: "x".repeat(20_000) });
    const link = `https://example.com/${"x".repeat(2048 - "https://example.com/".length)}`;
    expect(
      decodeSendMessageOutputSchema({
        kind: "link",
        url: link,
      })
    ).toMatchObject({ url: link });

    for (const input of [
      { kind: "message", text: "x".repeat(20_001) },
      { kind: "message", attachments: [] },
      {
        kind: "message",
        attachments: Array.from({ length: 5 }, () => ({ ...attachment })),
      },
      { kind: "message", attachments: [{ ...attachment, name: "" }] },
      {
        kind: "message",
        attachments: [{ ...attachment, name: "n".repeat(181) }],
      },
      { kind: "message", attachments: [{ ...attachment, mimeType: "" }] },
      {
        kind: "message",
        attachments: [{ ...attachment, mimeType: "m".repeat(201) }],
      },
      { kind: "link", url: `${link}x` },
    ])
      expect(() =>
        decodeSendMessageOutputSchema(input)
      ).toThrow(Schema.SchemaError);
  });

  it("rejects invalid content, protocols, discriminants and excess strict-object keys", () => {
    for (const input of [
      null,
      {},
      { kind: "message" },
      { kind: "message", text: "ok", replyTo: undefined },
      { kind: "message", text: "ok", attachments: null },
      { kind: "message", text: " \n " },
      {
        kind: "message",
        text: "",
        attachments: [{ kind: "image", url: "https://example.com" }],
      },
      { kind: "message", text: "ok", url: "https://example.com" },
      { kind: "link", url: "https://example.com", text: "no" },
      { kind: "message", text: "ok", replyTo: { kind: "current", id: "no" } },
      { kind: "message", text: "ok", replyTo: { kind: "task", id: "" } },
      {
        kind: "message",
        text: "ok",
        replyTo: { kind: "automation", id: "not-a-uuid" },
      },
      { kind: "link", url: "http://example.com" },
      { kind: "link", url: "javascript:alert(1)" },
      { kind: "link", url: "https://bad host" },
      {
        kind: "message",
        attachments: [{ kind: "image", url: "data:image/png;base64,a" }],
      },
      {
        kind: "message",
        attachments: [{ kind: "unknown", url: "https://example.com" }],
      },
    ])
      expect(() =>
        decodeSendMessageOutputSchema(input)
      ).toThrow(Schema.SchemaError);
  });

  it("returns a typed failure for malformed URLs without throwing a URL defect", () => {
    const result = decodeSendMessageOutputSchema2({
      kind: "link",
      url: "https://bad host",
    });

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isSuccess(result))
      throw new Error("Malformed URL was accepted.");
    expect(result.failure).toBeInstanceOf(Schema.SchemaError);
  });

  it("strips envelope metadata while enforcing the nested output contract", () => {
    expect(
      decodeSendMessageToolResultSchema({
        kind: "tool-result",
        toolName: "send_message",
        output: { kind: "message", text: " ok " },
        callId: "call-1",
        extra: true,
      })
    ).toEqual({
      kind: "tool-result",
      toolName: "send_message",
      output: { kind: "message", text: "ok" },
    });

    for (const input of [
      {
        kind: "tool-result",
        toolName: "other",
        output: { kind: "message", text: "ok" },
      },
      {
        kind: "tool-result",
        toolName: "send_message",
        output: { kind: "message", text: "ok", extra: true },
      },
    ])
      expect(
        Result.isSuccess(
          decodeSendMessageToolResultSchema2(input)
        )
      ).toBe(false);
  });
});

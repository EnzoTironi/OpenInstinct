import { asSchema } from "ai";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import messaging from "../../tools/messaging";
import { sendMessageOutputSchema } from "../../../shared/chat/message-delivery";
import {
  isToolSchema,
  serializeInputSchema,
  toInputSchema,
} from "../../../node_modules/eve/dist/src/tools/schema.js";

// Exercise the installed codec and the real dynamic definition without provider I/O.
const onTurnStarted = messaging.events["turn.started"];
if (!onTurnStarted) throw new Error("Messaging turn handler is required.");
const tools = await onTurnStarted(
  {},
  {
    channel: { kind: "http" },
    messages: [],
    session: { id: "codec-proof", auth: { current: null, initiator: null } },
  }
);
if (!tools) throw new Error("Interactive messaging tools are required.");
const original = tools.send_message.inputSchema;
const decodeJsonObject = Schema.decodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);

describe("message delivery native Eve codec", () => {
  it("recognizes the actual tool and serializes both discriminated variants", async () => {
    expect(isToolSchema(original)).toBe(true);
    const encoded = decodeJsonObject(
      JSON.stringify(serializeInputSchema(original))
    );
    expect(encoded).toHaveProperty("anyOf");
    const restored = toInputSchema(encoded);
    expect(isToolSchema(restored)).toBe(true);
    expect(await asSchema(restored).jsonSchema).toHaveProperty("anyOf");
  });

  it("accepts message content and reply handles before and after persistence", async () => {
    const restored = toInputSchema(
      decodeJsonObject(JSON.stringify(serializeInputSchema(original)))
    );
    const validations: Promise<void>[] = [];
    for (const schema of [toInputSchema(original), restored]) {
      for (const input of [
        { kind: "message", text: "Hello", replyTo: { kind: "current" } },
        {
          kind: "message",
          text: "x".repeat(20_000),
          replyTo: { kind: "task", id: "task-1" },
        },
        {
          kind: "message",
          attachments: [
            { kind: "image", url: "https://example.com/image.png" },
          ],
        },
        {
          kind: "link",
          url: "https://example.com",
          replyTo: {
            kind: "automation",
            id: "00000000-0000-4000-8000-000000000003",
          },
        },
      ]) {
        validations.push(
          (async () => {
            const validation = await schema["~standard"].validate(input);
            expect(validation).toEqual({
              value: Schema.decodeUnknownSync(sendMessageOutputSchema)(input),
            });
          })()
        );
      }
    }
    await Promise.all(validations);
  });

  it("accepts attachment metadata for canonical stripping after rehydration", async () => {
    const restored = toInputSchema(
      decodeJsonObject(JSON.stringify(serializeInputSchema(original)))
    );
    const input = {
      kind: "message",
      attachments: [{ kind: "file", url: "https://example.com", extra: true }],
    };
    const validation = await restored["~standard"].validate(input);
    expect(validation.issues).toBeUndefined();
    if (validation.issues) throw new Error("Attachment metadata was rejected.");
    expect(
      Schema.decodeUnknownSync(sendMessageOutputSchema)(validation.value)
    ).toEqual({
      kind: "message",
      attachments: [{ kind: "file", url: "https://example.com" }],
    });
  });

  it("rejects malformed, oversized and excess inputs after actual rehydration", async () => {
    const restored = toInputSchema(
      decodeJsonObject(JSON.stringify(serializeInputSchema(original)))
    );
    const validations: Promise<void>[] = [];
    for (const schema of [toInputSchema(original), restored]) {
      for (const input of [
        null,
        {},
        { kind: "message" },
        { kind: "message", text: "" },
        { kind: "message", text: "hi", replyTo: null },
        { kind: "message", text: "hi", attachments: null },
        { kind: "link", url: "https://example.com/" + "x".repeat(2048) },
        { kind: "message", text: "x".repeat(20_001) },
        { kind: "message", text: "hi", extra: true },
        {
          kind: "message",
          text: "hi",
          replyTo: { kind: "current", id: "wrong" },
        },
        { kind: "message", attachments: [] },
        {
          kind: "message",
          attachments: [{ kind: "image", url: "http://example.com" }],
        },
        { kind: "link", url: "http://example.com" },
        { kind: "link", url: "https://example.com", text: "wrong" },
      ]) {
        validations.push(
          (async () => {
            const validation = await schema["~standard"].validate(input);
            expect(validation.issues).toBeDefined();
            expect(validation.issues?.length).toBeGreaterThan(0);
          })()
        );
      }
    }
    await Promise.all(validations);
  });
});

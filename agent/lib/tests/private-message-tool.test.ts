import { asSchema } from "ai";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

// Eve 0.49's pure codec is not publicly exported. Exercise the installed codec:
// AI SDK conversion alone misses Eve's object-only Standard Schema detection.
// This import performs schema conversion only; no runtime or provider is invoked.
import {
  isToolSchema,
  serializeInputSchema,
  toInputSchema,
} from "../../../node_modules/eve/dist/src/tools/schema.js";
import { privateMessageTool } from "../private-message-tool";

const decodeJsonObject = Schema.decodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);

describe.each(["telegram", "kapso"] as const)(
  "%s private message schema",
  (channel) => {
    it("survives Eve serialization and rehydration as an AI SDK object schema", async () => {
      const tool = privateMessageTool(channel);
      expect(isToolSchema(tool.inputSchema)).toBe(true);
      const encoded = serializeInputSchema(tool.inputSchema);
      const persisted = decodeJsonObject(JSON.stringify(encoded));
      expect(persisted).toMatchObject({
        type: "object",
        required: ["kind", "text"],
        additionalProperties: false,
        properties: {
          kind: { enum: ["message"] },
          text: { type: "string", minLength: 1, maxLength: 16_384 },
          replyTo: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: { kind: { enum: ["current"] } },
          },
        },
      });
      const restored = toInputSchema(persisted);
      expect(isToolSchema(restored)).toBe(true);
      expect(serializeInputSchema(restored)).toMatchObject({
        type: "object",
        required: ["kind", "text"],
        additionalProperties: false,
      });
      expect(await asSchema(restored).jsonSchema).toMatchObject({
        type: "object",
      });
    });

    it("preserves plain text and current-message replies through the codec", async () => {
      const original = privateMessageTool(channel).inputSchema;
      const restored = toInputSchema(
        decodeJsonObject(JSON.stringify(serializeInputSchema(original)))
      );
      await Promise.all(
        [toInputSchema(original), restored].flatMap((schema) =>
          [
            { kind: "message", text: "Olá — https://example.invalid" },
            {
              kind: "message",
              text: "x".repeat(16_384),
              replyTo: { kind: "current" },
            },
          ].map(async (input) => {
            expect(await schema["~standard"].validate(input)).toEqual({
              value: input,
            });
          })
        )
      );
    });

    it("rejects malformed and excess input before and after serialization", async () => {
      const original = privateMessageTool(channel).inputSchema;
      const restored = toInputSchema(
        decodeJsonObject(JSON.stringify(serializeInputSchema(original)))
      );
      await Promise.all(
        [toInputSchema(original), restored].flatMap((schema) =>
          [
            null,
            {},
            { kind: "reaction", text: "hello" },
            { kind: "message", text: "" },
            { kind: "message", text: "x".repeat(16_385) },
            { kind: "message", text: 123 },
            { kind: "message", text: "hello", identityId: "another-recipient" },
            { kind: "message", text: "hello", attachments: [] },
            {
              kind: "message",
              text: "hello",
              replyTo: { kind: "message", id: "other" },
            },
            {
              kind: "message",
              text: "hello",
              replyTo: { kind: "current", id: "other" },
            },
          ].map(async (input) => {
            const result = await schema["~standard"].validate(input);
            expect(result.issues).toBeDefined();
            expect(result.issues?.length).toBeGreaterThan(0);
          })
        )
      );
    });
  }
);

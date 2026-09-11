import { asSchema } from "ai";
import { Predicate, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  isToolSchema,
  serializeInputSchema,
  toInputSchema,
} from "../../../node_modules/eve/dist/src/tools/schema.js";
import {
  addReactionToMessageOutputSchema,
  reactToMessageOutputSchema,
} from "../../../shared/chat/reaction";
import messaging from "../../tools/messaging";

const decodeJsonObject = Schema.decodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);
const decodeReactToMessageOutput = Schema.decodeUnknownSync(
  reactToMessageOutputSchema
);
const decodeAddReactionToMessageOutput = Schema.decodeUnknownSync(
  addReactionToMessageOutputSchema
);

// Real dynamic tools and installed Eve/AI SDK codecs; no provider I/O.
describe.each(["http", "channel:linq"])("reaction codec for %s", (channel) => {
  it("preserves defaults, allowed operations and stripping across JSON persistence", async () => {
    const handler = messaging.events["turn.started"];

    if (!handler) throw new Error("Messaging turn handler is required.");

    const tools = await handler(
      {},
      {
        channel: { kind: channel },
        messages: [],
        session: {
          id: "reaction-codec",
          auth: { current: null, initiator: null },
        },
      }
    );

    if (!Predicate.isObject(tools) || !("react_to_message" in tools))
      throw new Error("Reaction tool is required.");
    const reaction = tools.react_to_message;

    if (!Predicate.isObject(reaction) || !("inputSchema" in reaction))
      throw new Error("Reaction schema is required.");
    const original = reaction.inputSchema;
    expect(isToolSchema(original)).toBe(true);

    if (!isToolSchema(original))
      throw new Error("Reaction must use Standard Schema.");
    expect(await asSchema(original).jsonSchema).toMatchObject({
      type: "object",
    });

    const encoded = decodeJsonObject(
      JSON.stringify(serializeInputSchema(original))
    );

    expect(encoded).toMatchObject({
      type: "object",
      additionalProperties: true,
      properties: { operation: { default: "add" } },
      required: ["type"],
    });
    const restored = toInputSchema(encoded);
    expect(isToolSchema(restored)).toBe(true);
    expect(await asSchema(restored).jsonSchema).toMatchObject({
      type: "object",
    });
    expect(serializeInputSchema(restored)).toMatchObject({ type: "object" });

    const decodeCanonical =
      channel === "channel:linq"
        ? decodeReactToMessageOutput
        : decodeAddReactionToMessageOutput;

    const explicitUndefined = await original["~standard"].validate({
      type: "heart",
      operation: undefined,
    });

    expect(explicitUndefined.issues?.length).toBeGreaterThan(0);

    const valid = [
      { type: "thumbs_up" },
      { type: "thumbs_down" },
      { type: "heart" },
      { type: "laugh" },
      { type: "exclamation" },
      { type: "question" },
      { type: "heart", operation: "add", extra: "metadata" },
      ...(channel === "channel:linq"
        ? [{ type: "heart", operation: "remove" }]
        : []),
    ];

    const invalid = [
      null,
      {},
      [],
      { type: null },
      { type: "HEART" },
      { type: " heart " },
      { type: "heart", operation: null },
      { type: "heart", operation: "replace" },
      ...(channel === "http" ? [{ type: "heart", operation: "remove" }] : []),
    ];

    await Promise.all(
      [toInputSchema(original), restored].flatMap((schema) =>
        valid
          .map(async (input) => {
            const result = await schema["~standard"].validate(input);
            expect(result.issues).toBeUndefined();

            if (result.issues) throw new Error("Valid reaction was rejected.");
            expect(result.value).toMatchObject({
              operation: input.operation ?? "add",
              type: input.type,
            });
            expect(decodeCanonical(result.value)).toEqual(
              decodeCanonical(input)
            );
          })
          .concat(
            invalid.map(async (input) => {
              const result = await schema["~standard"].validate(input);
              expect(result.issues?.length).toBeGreaterThan(0);
            })
          )
      )
    );
  });
});

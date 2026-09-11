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

const isLinqChannel = (channel: string) => channel === "channel:linq";

const decodeCanonicalFor = (channel: string) =>
  isLinqChannel(channel)
    ? decodeReactToMessageOutput
    : decodeAddReactionToMessageOutput;

const validReactionsFor = (channel: string) => [
  { type: "thumbs_up" },
  { type: "thumbs_down" },
  { type: "heart" },
  { type: "laugh" },
  { type: "exclamation" },
  { type: "question" },
  { type: "heart", operation: "add", extra: "metadata" },
  ...(isLinqChannel(channel) ? [{ type: "heart", operation: "remove" }] : []),
];

const invalidReactionsFor = (channel: string) => [
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

type ReactionToolSchema = NonNullable<ReturnType<typeof toInputSchema>>;

type MessagingTurnStarted = NonNullable<
  (typeof messaging.events)["turn.started"]
>;

type MessagingTools = Awaited<ReturnType<MessagingTurnStarted>>;

interface ReactionToolEntry {
  readonly inputSchema: ReactionToolSchema;
}

const hasReactToMessage = (
  tools: MessagingTools
): tools is MessagingTools & {
  readonly react_to_message: ReactionToolEntry;
} => Predicate.isObject(tools) && "react_to_message" in tools;

const hasInputSchema = (reaction: {
  readonly inputSchema?: ReactionToolSchema;
}): reaction is ReactionToolEntry =>
  "inputSchema" in reaction && reaction.inputSchema !== undefined;

const assertValidReactionInputs = (
  schema: ReactionToolSchema,
  valid: ReturnType<typeof validReactionsFor>,
  decodeCanonical: ReturnType<typeof decodeCanonicalFor>
) =>
  valid.map(async (input) => {
    const result = await schema["~standard"].validate(input);
    expect(result.issues).toBeUndefined();

    if (result.issues) throw new Error("Valid reaction was rejected.");
    expect(result.value).toMatchObject({
      operation: input.operation ?? "add",
      type: input.type,
    });
    expect(decodeCanonical(result.value)).toEqual(decodeCanonical(input));
  });

const assertInvalidReactionInputs = (
  schema: ReactionToolSchema,
  invalid: ReturnType<typeof invalidReactionsFor>
) =>
  invalid.map(async (input) => {
    const result = await schema["~standard"].validate(input);
    expect(result.issues?.length).toBeGreaterThan(0);
  });

const reactionValidationPromises = (
  schemas: readonly ReactionToolSchema[],
  channel: string,
  decodeCanonical: ReturnType<typeof decodeCanonicalFor>
) => {
  const valid = validReactionsFor(channel);
  const invalid = invalidReactionsFor(channel);

  return schemas.flatMap((schema) => [
    ...assertValidReactionInputs(schema, valid, decodeCanonical),
    ...assertInvalidReactionInputs(schema, invalid),
  ]);
};

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

    if (!hasReactToMessage(tools))
      throw new Error("Reaction tool is required.");
    const reaction = tools.react_to_message;

    if (!hasInputSchema(reaction))
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

    const decodeCanonical = decodeCanonicalFor(channel);

    const explicitUndefined = await original["~standard"].validate({
      type: "heart",
      operation: undefined,
    });

    expect(explicitUndefined.issues?.length).toBeGreaterThan(0);

    await Promise.all(
      reactionValidationPromises(
        [toInputSchema(original), restored],
        channel,
        decodeCanonical
      )
    );
  });
});

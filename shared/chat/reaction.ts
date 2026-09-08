import { Effect, Schema } from "effect";

const reactionTypeSchema = Schema.Literals([
  "thumbs_up",
  "thumbs_down",
  "heart",
  "laugh",
  "exclamation",
  "question",
]);

// JSON-shaped contract: only omission defaults to add. Explicit JS undefined
// is intentionally rejected; value-level defaults would admit null on the wire.
export const reactToMessageOutputSchema = Schema.Struct({
  operation: Schema.Literals(["add", "remove"])
    .annotate({ default: "add" })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("add"))),
  type: reactionTypeSchema,
}).annotate({
  additionalProperties: true,
  parseOptions: { onExcessProperty: "ignore" },
});

export const addReactionToMessageOutputSchema = Schema.Struct({
  ...reactToMessageOutputSchema.fields,
  operation: Schema.Literal("add")
    .annotate({ default: "add" })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("add"))),
}).annotate({
  additionalProperties: true,
  parseOptions: { onExcessProperty: "ignore" },
});

const reactionText = {
  exclamation: "‼️",
  heart: "❤️",
  laugh: "😂",
  question: "❓",
  thumbs_down: "👎",
  thumbs_up: "👍",
} as const satisfies Record<typeof reactionTypeSchema.Type, string>;

export function reactionTextFor(type: typeof reactionTypeSchema.Type) {
  return reactionText[type];
}

export const reactToMessageToolResultSchema = Schema.Struct({
  kind: Schema.Literal("tool-result"),
  output: reactToMessageOutputSchema,
  toolName: Schema.Literal("react_to_message"),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });

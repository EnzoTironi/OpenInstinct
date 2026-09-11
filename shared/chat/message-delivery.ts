import { Schema, SchemaTransformation } from "effect";

const replyReferenceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("current") }),
  Schema.Struct({ id: Schema.NonEmptyString, kind: Schema.Literal("task") }),
  Schema.Struct({
    id: Schema.String.check(Schema.isUUID()),
    kind: Schema.Literal("automation"),
  }),
]).annotate({ parseOptions: { onExcessProperty: "error" } });

export type ReplyReference = typeof replyReferenceSchema.Type;

const httpsUrlSchema = Schema.String.check(
  Schema.makeFilter(
    (url) => URL.canParse(url) && new URL(url).protocol === "https:",
    {
      message: "The URL must be valid and use HTTPS.",
      toJsonSchema: () => ({
        format: "uri",
        pattern: "^[hH][tT][tT][pP][sS]:",
      }),
    }
  )
);

const attachmentSchema = Schema.Struct({
  kind: Schema.Literals(["image", "video", "audio", "file"]),
  mimeType: Schema.optionalKey(
    Schema.NonEmptyString.check(Schema.isMaxLength(200))
  ),
  name: Schema.optionalKey(
    Schema.NonEmptyString.check(Schema.isMaxLength(180))
  ),
  url: httpsUrlSchema.pipe(
    Schema.decodeTo(Schema.String, SchemaTransformation.trim())
  ),
}).annotate({
  additionalProperties: true,
  parseOptions: { onExcessProperty: "ignore" },
});

const textSchema = Schema.String.check(
  Schema.makeFilter(
    (text) => text.trim().length >= 1 && text.trim().length <= 20_000,
    {
      message:
        "Message text must contain between 1 and 20000 characters after trimming.",
      toJsonSchema: () => ({ minLength: 1, maxLength: 20_000 }),
    }
  )
).pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim()));

const attachmentsSchema = Schema.Array(attachmentSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4)
);

const messageFields = {
  attachments: Schema.optionalKey(attachmentsSchema),
  kind: Schema.Literal("message"),
  text: Schema.optionalKey(textSchema),
  replyTo: Schema.optionalKey(replyReferenceSchema),
};

const messageOutputSchema = Schema.Union([
  Schema.Struct({ ...messageFields, text: textSchema }),
  Schema.Struct({ ...messageFields, attachments: attachmentsSchema }),
]).annotate({ parseOptions: { onExcessProperty: "error" } });

const linkOutputSchema = Schema.Struct({
  kind: Schema.Literal("link"),
  replyTo: Schema.optionalKey(replyReferenceSchema),
  url: httpsUrlSchema
    .pipe(
      Schema.check(
        Schema.makeFilter((url) => url.trim().length <= 2048, {
          message: "Native links must not exceed 2048 characters.",
          toJsonSchema: () => ({ maxLength: 2048 }),
        })
      )
    )
    .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim())),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export const sendMessageOutputSchema = Schema.Union([
  messageOutputSchema,
  linkOutputSchema,
]);

const deliveryMetadata = {
  deliveryId: Schema.optionalKey(Schema.NonEmptyString),
};

const deliveredMessageSchema = Schema.Union([
  Schema.Struct({
    ...messageOutputSchema.members[0].fields,
    ...deliveryMetadata,
  }),
  Schema.Struct({
    ...messageOutputSchema.members[1].fields,
    ...deliveryMetadata,
  }),
  Schema.Struct({ ...linkOutputSchema.fields, ...deliveryMetadata }),
]).annotate({ parseOptions: { onExcessProperty: "error" } });

export const sendMessageToolResultSchema = Schema.Struct({
  kind: Schema.Literal("tool-result"),
  output: deliveredMessageSchema,
  toolName: Schema.Literal("send_message"),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });

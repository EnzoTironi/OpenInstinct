import { Effect, Schema } from "effect";
import type { ToolContext } from "eve/tools";
import { searchGmail } from "./google-workspace/gmail";
import { searchGoogleContacts } from "./google-workspace/contacts";
import { listCalendarEvents } from "./google-workspace/calendar";
import type { SandboxToolInvoker } from "../../vendor/executor/core";

const query = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(500)),
});
const calendar = Schema.Struct({
  timeMin: Schema.String,
  timeMax: Schema.String,
  timezone: Schema.String.check(Schema.isMaxLength(80)),
});
class ExecutorProviderError extends Schema.TaggedError<ExecutorProviderError>()(
  "ExecutorProviderError",
  {}
) {}

export const invokeGoogleTool = Effect.fn("invokeGoogleTool")(function* (
  call: Parameters<SandboxToolInvoker["invoke"]>[0],
  context: ToolContext
) {
  if (call.path === "workspace.google.mail.search") {
    const input = yield* Schema.decodeUnknownEffect(query)(call.args, {
      onExcessProperty: "error",
    });
    return yield* Effect.tryPromise({
      try: () => searchGmail(context, input.query, 10),
      catch: () => new ExecutorProviderError(),
    });
  }
  if (call.path === "workspace.google.contacts.search") {
    const input = yield* Schema.decodeUnknownEffect(query)(call.args, {
      onExcessProperty: "error",
    });
    return yield* Effect.tryPromise({
      try: () => searchGoogleContacts(context, input.query, 10),
      catch: () => new ExecutorProviderError(),
    });
  }
  if (call.path === "workspace.google.calendar.list") {
    const input = yield* Schema.decodeUnknownEffect(calendar)(call.args, {
      onExcessProperty: "error",
    });
    return yield* Effect.tryPromise({
      try: () =>
        listCalendarEvents(context, {
          ...input,
          calendarId: "primary",
          maxResults: 20,
        }),
      catch: () => new ExecutorProviderError(),
    });
  }
  return yield* new ExecutorProviderError();
});

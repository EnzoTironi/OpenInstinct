import { Effect, Schema } from "effect";
import type { ToolContext } from "eve/tools";
import {
  isConnectionAuthorizationRequiredError,
  isConnectionAuthorizationFailedError,
} from "eve/connections";
import { searchGmail } from "@agent/lib/google-workspace/gmail";
import { searchGoogleContacts } from "@agent/lib/google-workspace/contacts";
import { listCalendarEvents } from "@agent/lib/google-workspace/calendar";
import type { SandboxToolInvoker } from "../../vendor/executor/core";

export const GoogleSearchQuery = Schema.Struct({
  query: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
});
export const GoogleCalendarQuery = Schema.Struct({
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
    const input = yield* Schema.decodeUnknownEffect(GoogleSearchQuery)(
      call.args,
      {
        onExcessProperty: "error",
      }
    );
    return yield* Effect.tryPromise({
      try: () => searchGmail(context, input.query, 10),
      catch: (cause) =>
        isConnectionAuthorizationRequiredError(cause) ||
        isConnectionAuthorizationFailedError(cause)
          ? cause
          : new ExecutorProviderError(),
    });
  }
  if (call.path === "workspace.google.contacts.search") {
    const input = yield* Schema.decodeUnknownEffect(GoogleSearchQuery)(
      call.args,
      {
        onExcessProperty: "error",
      }
    );
    return yield* Effect.tryPromise({
      try: () => searchGoogleContacts(context, input.query, 10),
      catch: (cause) =>
        isConnectionAuthorizationRequiredError(cause) ||
        isConnectionAuthorizationFailedError(cause)
          ? cause
          : new ExecutorProviderError(),
    });
  }
  if (call.path === "workspace.google.calendar.list") {
    const input = yield* Schema.decodeUnknownEffect(GoogleCalendarQuery)(
      call.args,
      {
        onExcessProperty: "error",
      }
    );
    return yield* Effect.tryPromise({
      try: () =>
        listCalendarEvents(context, {
          ...input,
          calendarId: "primary",
          maxResults: 20,
        }),
      catch: (cause) =>
        isConnectionAuthorizationRequiredError(cause) ||
        isConnectionAuthorizationFailedError(cause)
          ? cause
          : new ExecutorProviderError(),
    });
  }
  return yield* new ExecutorProviderError();
});

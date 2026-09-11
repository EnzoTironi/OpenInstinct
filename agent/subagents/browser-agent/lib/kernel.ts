import Kernel from "@onkernel/sdk";
import { Config, Effect, Redacted, Schema } from "effect";

class BrowserUnavailable extends Schema.TaggedError<BrowserUnavailable>()(
  "BrowserUnavailable",
  { message: Schema.String }
) {}

const configuredKernel = Config.schema(
  Schema.RedactedFromValue(Schema.NonEmptyString.check(Schema.isTrimmed())),
  "KERNEL_API_KEY"
).pipe(
  Effect.map((apiKey) => new Kernel({ apiKey: Redacted.value(apiKey) })),
  Effect.mapError(
    () =>
      new BrowserUnavailable({
        message:
          "Browser execution is not configured. Set KERNEL_API_KEY to enable it.",
      })
  )
);

let client: Kernel | undefined;

export function getKernel() {
  client ??= Effect.runSync(configuredKernel);

  return client;
}

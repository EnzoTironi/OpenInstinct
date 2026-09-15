import { Effect, Redacted } from "effect";
import { openBitwardenExport } from "./bitwarden";

self.addEventListener(
  "message",
  (event: MessageEvent<{ source: string; password: string }>) => {
    void Effect.runPromise(
      openBitwardenExport(
        event.data.source,
        Redacted.make(event.data.password)
      ).pipe(
        Effect.match({
          onFailure: () => {
            self.postMessage(null, { transfer: [] });
          },
          onSuccess: (result) => {
            self.postMessage(result, { transfer: [] });
          },
        }),
        Effect.catchDefect(() =>
          Effect.sync(() => {
            self.postMessage(null, { transfer: [] });
          })
        )
      )
    );
  },
  { once: true }
);

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, Redacted } from "effect";

import { resetDisposableApplication } from "../server/database/reset-disposable.ts";
import {
  confirmArgument,
  ResetRefused,
} from "../server/database/reset-target.ts";

Effect.gen(function* () {
  const confirm = confirmArgument(process.argv.slice(2));
  if (!confirm) {
    return yield* new ResetRefused({
      message:
        "Pass --confirm <database-name> matching the disposable DATABASE_URL target.",
    });
  }
  const direct = yield* Config.redacted("DATABASE_URL_UNPOOLED").pipe(
    Config.withDefault(Redacted.make(""))
  );
  const pooled = yield* Config.redacted("DATABASE_URL").pipe(
    Config.withDefault(Redacted.make(""))
  );
  const url = Redacted.value(direct) || Redacted.value(pooled);
  if (!url) {
    return yield* new ResetRefused({
      message:
        "Set DATABASE_URL_UNPOOLED or DATABASE_URL for disposable reset.",
    });
  }
  const result = yield* resetDisposableApplication(url, confirm);
  yield* Effect.logInfo("Disposable database reset completed", result);
  return result;
}).pipe(
  Effect.timeout("10 minutes"),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);

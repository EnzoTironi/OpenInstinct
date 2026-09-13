import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Docker from "alchemy/Docker";
import * as Fly from "alchemy/Fly";
import { Stage } from "alchemy/Stage";
import { Config, Effect, Layer } from "effect";
import { hosted } from "./hosted.ts";
import { localDatabase, localProviders } from "./local.ts";
import { cloudflareProviders } from "./cloudflare.ts";

export default Effect.gen(function* () {
  const stage = yield* Stage;
  const target = yield* Config.literals(
    ["local", "fly"],
    "ZOEN_DEPLOY_TARGET"
  ).pipe(
    Config.withDefault(
      stage === "prod" || stage === "staging" ? "fly" : "local"
    )
  );
  if (target === "local") {
    return yield* Alchemy.Stack(
      "CompanionLocal",
      { providers: localProviders, state: Alchemy.localState() },
      localDatabase
    );
  }
  return yield* Alchemy.Stack(
    "Zoen",
    {
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Native provider collections erase their runtime context; the isolated infrastructure tsc checks this composition.
      providers: Layer.mergeAll(
        Fly.providers(),
        Docker.providers(),
        cloudflareProviders
      ),
      state: Cloudflare.state(),
    },
    hosted
  );
});

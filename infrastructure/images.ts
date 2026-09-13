import * as Docker from "alchemy/Docker";
import * as Output from "alchemy/Output";
import { Config, Effect, Option } from "effect";

/** An explicit digest supports adopting a deployment or rolling back without rebuilding it. */
export const releaseImage = Effect.fn(function* (
  component: "Postgres" | "Web" | "Memory" | "Matrix",
  appName: string,
  context: string
) {
  const pinned = yield* Config.string(
    `ZOEN_${component.toUpperCase()}_IMAGE`
  ).pipe(Config.option);
  if (Option.isSome(pinned)) {
    if (!/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(pinned.value)) {
      return yield* Effect.die(
        new Error(`${component} image must include an immutable sha256 digest.`)
      );
    }
    return Output.literal(pinned.value);
  }
  const release = yield* Config.string("ZOEN_RELEASE");
  if (!/^[a-f0-9]{40}$/.test(release)) {
    return yield* Effect.die(
      new Error("ZOEN_RELEASE must be the full tested Git commit SHA.")
    );
  }
  const token = yield* Config.redacted("FLY_API_TOKEN");
  const image = yield* Docker.Image(`${component}Image`, {
    name: `registry.fly.io/${appName}`,
    tag: release,
    registry: { server: "registry.fly.io", username: "x", password: token },
    build: {
      context,
      platform: "linux/amd64",
      // Attestation timestamps otherwise change the OCI index on a cached
      // build, making an unchanged plan restart the database and memory.
      options: ["--provenance=false"],
    },
  });
  return image.repoDigest.pipe(
    Output.map((digest) => {
      if (!digest)
        throw new Error(`${component} image push did not return a digest.`);
      return digest;
    })
  );
});

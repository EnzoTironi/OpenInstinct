import { Effect, Layer, Schema } from "effect";

import { ChannelAccounts } from "../../server/accounts";
import { Artifacts } from "../../server/artifacts";
import {
  ArtifactAccessSchema,
  ArtifactSourceSchema,
} from "../../server/artifacts/model";
import { runtimeDatabase } from "./database";

const services = Artifacts.layer.pipe(
  Layer.provideMerge(
    ChannelAccounts.layer.pipe(Layer.provideMerge(runtimeDatabase))
  )
);

const operation = Schema.decodeUnknownSync(Schema.Literals(["put", "read"]))(
  process.argv[2]
);

const raw = process.argv[3];

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const artifacts = yield* Artifacts;

    if (operation === "put") {
      const input = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(ArtifactSourceSchema)
      )(raw);

      const metadata = yield* artifacts.put({
        ...input,
        bytes: Buffer.from("stored before writer process exited"),
      });

      return {
        artifactId: metadata.artifactId,
        sha256: metadata.sha256,
        text: "",
      };
    }

    const input = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(ArtifactAccessSchema)
    )(raw);

    const stored = yield* artifacts.read(input);

    return {
      artifactId: stored.metadata.artifactId,
      sha256: stored.metadata.sha256,
      text: Buffer.from(stored.bytes).toString("utf8"),
    };
  }).pipe(Effect.provide(services))
);

process.stdout.write(JSON.stringify(result));

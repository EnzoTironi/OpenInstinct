import { Effect, Layer, Schema } from "effect";

import { ChannelAccounts } from "../../server/accounts";
import { Artifacts } from "../../server/artifacts";
import {
  ArtifactAccessSchema,
  ArtifactSourceSchema,
} from "../../server/artifacts/model";
import { runtimeDatabase } from "./database";
const decodeSchema_Literals_put_read = Schema.decodeUnknownSync(Schema.Literals(["put", "read"]));
const decodeSchema_fromJsonString_ArtifactSourceSchema = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactSourceSchema));
const decodeSchema_fromJsonString_ArtifactAccessSchema = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactAccessSchema));

const services = Artifacts.layer.pipe(
  Layer.provideMerge(
    ChannelAccounts.layer.pipe(Layer.provideMerge(runtimeDatabase))
  )
);

const operation = decodeSchema_Literals_put_read(
  process.argv[2]
);

const raw = process.argv[3];

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const artifacts = yield* Artifacts;

    if (operation === "put") {
      const input = yield* decodeSchema_fromJsonString_ArtifactSourceSchema(raw);

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

    const input = yield* decodeSchema_fromJsonString_ArtifactAccessSchema(raw);

    const stored = yield* artifacts.read(input);

    return {
      artifactId: stored.metadata.artifactId,
      sha256: stored.metadata.sha256,
      text: Buffer.from(stored.bytes).toString("utf8"),
    };
  }).pipe(Effect.provide(services))
);

process.stdout.write(JSON.stringify(result));

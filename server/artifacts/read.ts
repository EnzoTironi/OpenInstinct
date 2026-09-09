import { Effect } from "effect";
import { Artifacts } from "./index";
import { decodeMediaText, identifyMedia } from "../channels/media/policy";

export const readArtifactText = Effect.fn("readArtifactText")(function* (
  identityId: string,
  artifactId: string
) {
  const artifacts = yield* Artifacts;
  const stored = yield* artifacts.read({ identityId, artifactId });
  if (stored.derived)
    return {
      metadata: stored.metadata,
      content: stored.derived,
      untrusted: true as const,
    };
  const decoded = yield* Effect.gen(function* () {
    const mediaType = yield* identifyMedia(stored.bytes, {
      id: stored.metadata.sourceMediaId,
      mediaType: stored.metadata.mediaType,
      name: stored.metadata.filename,
    });
    if (
      mediaType !== "text/plain" &&
      mediaType !== "text/csv" &&
      mediaType !== "application/json"
    )
      return null;
    const text = yield* decodeMediaText(stored.bytes);
    yield* artifacts.setDerived({
      identityId,
      artifactId,
      sha256: stored.metadata.sha256,
      kind: "text",
      text,
    });
    return { kind: "text" as const, text };
  }).pipe(Effect.catchTag("ChannelMediaError", () => Effect.succeed(null)));
  return {
    metadata: stored.metadata,
    content: decoded,
    untrusted: true as const,
  };
});

import { Effect } from "effect";

import type { Identity } from "../../accounts";
import { Artifacts } from "../../artifacts";
import type { MessagePayload } from "../../messaging/model";
import { Kapso } from "../kapso";
import { Telegram } from "../telegram";
import { ChannelTransport } from "../transport";
import { ChannelMediaError, mediaLimits } from "./policy";

export const loadChannelArtifacts = Effect.fn("loadChannelArtifacts")(
  function* (
    identity: Identity,
    payload: MessagePayload,
    sourceInboxId: string
  ) {
    const artifacts = yield* Artifacts;
    const transport = yield* ChannelTransport;

    const stored = yield* Effect.reduce(
      payload.attachments ?? [],
      () => ({
        remaining: mediaLimits.totalBytes,
        items:
          // SAFETY: empty array is a valid accumulator for artifact reads.
          [] as Effect.Success<ReturnType<Artifacts["Service"]["read"]>>[],
      }),
      Effect.fn("loadChannelArtifacts.accumulate")(
        function* (state, reference) {
          yield* transport.activeIdentity(identity.id, identity.channel);

          const source = {
            identityId: identity.id,
            sourceInboxId,
            mediaId: reference.id,
          };

          let artifact = yield* artifacts.readForSource(source);

          if (!artifact) {
            const provider =
              identity.channel === "telegram" ? yield* Telegram : yield* Kapso;

            const bytes = yield* provider
              .downloadMedia(
                identity.installationId,
                reference.id,
                state.remaining
              )
              .pipe(
                Effect.catchTag(
                  "ProviderInputError",
                  () => new ChannelMediaError({ reason: "download_failed" })
                )
              );

            const saved = yield* artifacts.put({ ...source, bytes });
            artifact = yield* artifacts.read({
              identityId: identity.id,
              artifactId: saved.artifactId,
            });
          }

          const remaining = state.remaining - artifact.bytes.byteLength;

          if (remaining < 0)
            return yield* new ChannelMediaError({ reason: "too_large" });

          return {
            remaining,
            items: [...state.items, artifact],
          };
        }
      )
    ).pipe(Effect.map((state) => state.items));

    return stored;
  }
);

import { ConfigProvider, Effect } from "effect";
import { expect, it } from "vitest";
import { transcribeChannelAudio } from "./transcription";

it("fails the unavailable transcription profile without a provider call", async () => {
  await expect(
    Effect.runPromise(
      transcribeChannelAudio(
        Buffer.from("unused because the profile is absent"),
        "audio/wav"
      ).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({})
        )
      )
    )
  ).rejects.toMatchObject({ reason: "transcription_unavailable" });
});

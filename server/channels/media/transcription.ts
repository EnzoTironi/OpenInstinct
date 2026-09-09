import { ChannelTranscriptSchema } from "../../messaging/model";
import { NodeServices } from "@effect/platform-node";
import { createGateway, transcribe } from "ai";
import { Config, Effect, FileSystem, Redacted, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ChannelMediaError, mediaLimits } from "./policy";

const audioType = Schema.Literals(["audio/ogg", "audio/wav"]);
const probeResult = Schema.Struct({
  streams: Schema.Array(
    Schema.Struct({
      codec_type: Schema.Literal("audio"),
      codec_name: Schema.Literals(["opus", "pcm_s16le"]),
      channels: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 })),
    })
  ).check(Schema.isLengthBetween(1, 1)),
  format: Schema.Struct({
    duration: Schema.NumberFromString.check(
      Schema.isFinite(),
      Schema.isGreaterThan(0)
    ),
  }),
});

export const validateAudioDuration = Effect.fn("validateAudioDuration")(
  function* (bytes: Uint8Array, mediaType: typeof audioType.Type) {
    if (bytes.length > mediaLimits.audioBytes)
      return yield* new ChannelMediaError({ reason: "too_large" });
    const fs = yield* FileSystem.FileSystem;
    const path = yield* fs.makeTempFileScoped({ prefix: "companion-audio-" });
    yield* fs.writeFile(path, bytes, { mode: 0o600 });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const executable = yield* Config.string("COMPANION_FFPROBE_PATH").pipe(
      Config.withDefault("ffprobe")
    );
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        executable,
        [
          "-v",
          "error",
          "-max_alloc",
          "67108864",
          "-probesize",
          String(mediaLimits.audioBytes),
          "-analyzeduration",
          "2000000",
          "-protocol_whitelist",
          "file",
          "-f",
          mediaType === "audio/ogg" ? "ogg" : "wav",
          "-i",
          path,
          "-show_entries",
          "format=duration:stream=codec_type,codec_name,channels",
          "-of",
          "json",
        ],
        {
          stdin: "ignore",
          stderr: "ignore",
          env: { PATH: yield* Config.string("PATH") },
          extendEnv: false,
          forceKillAfter: "1 second",
        }
      )
    );
    const output = yield* handle.stdout.pipe(
      Stream.runFoldEffect(
        () => Buffer.alloc(0),
        (body, chunk) =>
          body.length + chunk.length > 8192
            ? Effect.fail(new ChannelMediaError({ reason: "invalid_media" }))
            : Effect.succeed(Buffer.concat([body, chunk]))
      )
    );
    if ((yield* handle.exitCode) !== 0)
      return yield* new ChannelMediaError({ reason: "invalid_media" });
    const probe = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(probeResult)
    )(output.toString("utf8")).pipe(
      Effect.mapError(() => new ChannelMediaError({ reason: "invalid_media" }))
    );
    if (probe.format.duration > mediaLimits.audioSeconds)
      return yield* new ChannelMediaError({ reason: "duration_limit" });
    return probe.format.duration;
  },
  Effect.scoped,
  Effect.timeout("5 seconds"),
  Effect.catchTag(
    ["PlatformError", "ConfigError"],
    () => new ChannelMediaError({ reason: "transcription_unavailable" })
  ),
  Effect.catchTag(
    "TimeoutError",
    () => new ChannelMediaError({ reason: "invalid_media" })
  ),
  Effect.provide(NodeServices.layer)
);

export const transcribeChannelAudio = Effect.fn("transcribeChannelAudio")(
  function* (bytes: Uint8Array, mediaType: typeof audioType.Type) {
    const profile = yield* Config.all({
      model: Config.nonEmptyString("COMPANION_TRANSCRIPTION_MODEL"),
      apiKey: Config.redacted("AI_GATEWAY_API_KEY"),
    }).pipe(
      Effect.mapError(
        () => new ChannelMediaError({ reason: "transcription_unavailable" })
      )
    );
    yield* validateAudioDuration(bytes, mediaType);
    const result = yield* Effect.tryPromise({
      try: (signal) =>
        transcribe({
          model: createGateway({
            apiKey: Redacted.value(profile.apiKey),
          }).transcriptionModel(profile.model),
          audio: bytes,
          abortSignal: signal,
          maxRetries: 0,
        }),
      catch: () => new ChannelMediaError({ reason: "transcription_failed" }),
    });
    return yield* Schema.decodeUnknownEffect(ChannelTranscriptSchema)(
      result.text.trim()
    ).pipe(
      Effect.mapError(
        () => new ChannelMediaError({ reason: "transcription_failed" })
      )
    );
  },
  Effect.timeout("40 seconds"),
  Effect.catchTag(
    "TimeoutError",
    () => new ChannelMediaError({ reason: "transcription_failed" })
  )
);

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { validateAudioDuration } from "../../server/channels/media/transcription";

function silentWav(seconds: number) {
  const byteLength = seconds * 8000 * 2;
  const bytes = Buffer.alloc(44 + byteLength);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + byteLength, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(byteLength, 40);
  return bytes;
}

describe("audio preflight with the installed ffprobe binary", () => {
  it("reads the real duration of a generated PCM WAV", async () => {
    await expect(
      Effect.runPromise(validateAudioDuration(silentWav(1), "audio/wav"))
    ).resolves.toBe(1);
  });
  it("rejects a real WAV over two minutes before transcription", async () => {
    await expect(
      Effect.runPromise(validateAudioDuration(silentWav(121), "audio/wav"))
    ).rejects.toMatchObject({ reason: "duration_limit" });
  });
  it("rejects invalid audio without treating the extension or MIME as proof", async () => {
    await expect(
      Effect.runPromise(
        validateAudioDuration(Buffer.from("not audio"), "audio/ogg")
      )
    ).rejects.toMatchObject({ reason: "invalid_media" });
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ChannelMediaError,
  decodeMediaText,
  identifyMedia,
  mediaFailureMessage,
  mediaLimits,
} from "./policy";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64"
);

describe("native media policy", () => {
  it("identifies actual image bytes when Telegram supplies an opaque media type", async () => {
    await expect(
      Effect.runPromise(
        identifyMedia(png, {
          id: "photo",
          mediaType: "application/octet-stream",
        })
      )
    ).resolves.toBe("image/png");
  });
  it("rejects a mismatched declared type", async () => {
    await expect(
      Effect.runPromise(
        identifyMedia(png, { id: "image", mediaType: "application/pdf" })
      )
    ).rejects.toMatchObject({ reason: "invalid_media" });
  });
  it("enforces the image limit even when the provider uses an opaque media type", async () => {
    const bytes = Buffer.alloc(mediaLimits.imageBytes + 1);
    png.copy(bytes);
    await expect(
      Effect.runPromise(
        identifyMedia(bytes, {
          id: "image",
          mediaType: "application/octet-stream",
        })
      )
    ).rejects.toMatchObject({ reason: "too_large" });
  });
  it("rejects unknown files instead of passing an inaccessible sandbox path to the model", async () => {
    await expect(
      Effect.runPromise(
        identifyMedia(Buffer.from("PK archive"), {
          id: "archive",
          mediaType: "application/zip",
        })
      )
    ).rejects.toMatchObject({ reason: "unsupported_type" });
  });
  it("decodes actual UTF-8 and refuses malformed or binary input", async () => {
    await expect(
      Effect.runPromise(
        decodeMediaText(Buffer.from("Reunião às 10h\nSão Paulo"))
      )
    ).resolves.toBe("Reunião às 10h\nSão Paulo");
    await expect(
      Effect.runPromise(decodeMediaText(Buffer.from([0xc3, 0x28])))
    ).rejects.toMatchObject({ reason: "invalid_media" });
    await expect(
      Effect.runPromise(decodeMediaText(Buffer.from([65, 0, 66])))
    ).rejects.toMatchObject({ reason: "invalid_media" });
  });
  it("enforces text limits independently of the message-wide download budget", async () => {
    await expect(
      Effect.runPromise(
        identifyMedia(Buffer.alloc(mediaLimits.textBytes + 1, 65), {
          id: "text",
          mediaType: "text/plain",
        })
      )
    ).rejects.toMatchObject({ reason: "too_large" });
  });
  it("provides a truthful alternative when voice transcription is unavailable", () => {
    expect(
      mediaFailureMessage(
        new ChannelMediaError({ reason: "transcription_unavailable" })
      )
    ).toBe(
      "Voice transcription is unavailable on this installation. Please send the information as text."
    );
  });
});

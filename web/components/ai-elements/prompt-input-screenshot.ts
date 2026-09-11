import { z } from "zod";

const hasGetDisplayMedia = (value: unknown): value is MediaDevices =>
  z.object({ getDisplayMedia: z.function() }).safeParse(value).success;

const mediaDevicesSchema = z.custom<MediaDevices>(hasGetDisplayMedia);

function resolveVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    video.addEventListener(
      "loadedmetadata",
      () => {
        resolve();
      },
      { once: true }
    );
    video.addEventListener(
      "error",
      () => {
        reject(new Error("Failed to load screen stream"));
      },
      { once: true }
    );
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
}

function stopStreamTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.srcObject = null;
}

function buildScreenshotFilename(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");

  return `screenshot-${timestamp}.png`;
}

async function captureFromStream(
  stream: MediaStream,
  video: HTMLVideoElement
): Promise<File | null> {
  video.srcObject = stream;
  await resolveVideoMetadata(video);
  await video.play();

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!(width && height)) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);

  const blob = await canvasToPngBlob(canvas);

  if (!blob) {
    return null;
  }

  return new File([blob], buildScreenshotFilename(), {
    lastModified: Date.now(),
    type: "image/png",
  });
}

export const captureScreenshot = async (): Promise<File | null> => {
  if (typeof navigator === "undefined") {
    return null;
  }

  const mediaDevices = mediaDevicesSchema.safeParse(navigator.mediaDevices);

  if (!mediaDevices.success) {
    return null;
  }

  let stream: MediaStream | null = null;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;

  try {
    stream = await mediaDevices.data.getDisplayMedia({
      audio: false,
      video: true,
    });

    return await captureFromStream(stream, video);
  } finally {
    if (stream) {
      stopStreamTracks(stream);
    }

    releaseVideo(video);
  }
};

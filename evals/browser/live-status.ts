import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  browserBenchmarkLiveStatusSchema,
  type BrowserBenchmarkLiveStatus,
} from "./live-status-schema.ts";

export type { BrowserBenchmarkLiveStatus } from "./live-status-schema.ts";

const writes = new Map<string, Promise<void>>();

const nodeErrorSchema = z.object({ code: z.string() });

export async function readBrowserBenchmarkLiveStatus(path: string) {
  try {
    return browserBenchmarkLiveStatusSchema.parse(
      JSON.parse(await readFile(path, "utf8"))
    );
  } catch (error) {
    const parsed = nodeErrorSchema.safeParse(error);

    if (parsed.success && parsed.data.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeBrowserBenchmarkLiveStatus(
  path: string,
  status: BrowserBenchmarkLiveStatus
) {
  const parsed = browserBenchmarkLiveStatusSchema.parse(status);
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    temporaryPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8"
  );
  await rename(temporaryPath, path);
}

export async function updateBrowserBenchmarkLiveStatus(
  path: string,
  runId: string,
  update: (status: BrowserBenchmarkLiveStatus) => BrowserBenchmarkLiveStatus
) {
  const previous = writes.get(path) ?? Promise.resolve();

  const next = previous.then(async () => {
    await withFileLock(path, async () => {
      const current = await readBrowserBenchmarkLiveStatus(path);

      if (!current || current.runId !== runId) return;
      await writeBrowserBenchmarkLiveStatus(path, {
        ...update(current),
        updatedAt: new Date().toISOString(),
      });
    });

    return undefined;
  });

  writes.set(path, next);

  try {
    await next;
  } finally {
    if (writes.get(path) === next) writes.delete(path);
  }
}

function shouldRetryBusyLock(
  parsed: ReturnType<typeof nodeErrorSchema.safeParse>,
  attempt: number
) {
  if (!parsed.success) return false;

  if (parsed.data.code !== "EEXIST") return false;

  return attempt < 600;
}

async function waitForLockRetry(lockPath: string, attempt: number) {
  if (attempt % 100 === 99 && (await lockIsStale(lockPath))) {
    await rm(lockPath, { force: true, recursive: true });

    return;
  }

  await delay(50);
}

async function acquireFileLock(lockPath: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- lock creation is the sequential acquisition attempt itself
      await mkdir(lockPath);

      return;
    } catch (error) {
      if (!shouldRetryBusyLock(nodeErrorSchema.safeParse(error), attempt)) {
        throw error;
      }

      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential lock acquisition retries
      await waitForLockRetry(lockPath, attempt);
    }
  }
}

async function withFileLock(path: string, action: () => Promise<void>) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  await acquireFileLock(lockPath);

  try {
    await action();
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

async function lockIsStale(path: string) {
  try {
    return Date.now() - (await stat(path)).mtimeMs > 30_000;
  } catch (error) {
    const parsed = nodeErrorSchema.safeParse(error);

    if (parsed.success && parsed.data.code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

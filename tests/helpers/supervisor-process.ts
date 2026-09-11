import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";

const LOG_POLL_INTERVAL_MS = 20;

const LOG_WAIT_TIMEOUT_MS = 5_000;

export const SUPERVISOR_TEST_TIMEOUT_MS = LOG_WAIT_TIMEOUT_MS + 5_000;

export function waitForSupervisorClose(supervisor: ChildProcess) {
  return new Promise<number | null>((resolve, reject) => {
    supervisor.once("error", reject);
    supervisor.once("close", resolve);
  });
}

async function readLogSnapshot(path: string) {
  try {
    return { contents: await readFile(path, "utf8"), readError: undefined };
  } catch (error) {
    return { contents: "", readError: error };
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readErrorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message;

  return "Unknown read error";
}

function lastObservation(contents: string, cause: unknown) {
  if (cause === undefined) {
    return `Last log contents: ${JSON.stringify(contents)}`;
  }

  return `Last log read failed: ${readErrorMessage(cause)}`;
}

export async function waitForSupervisorLogEntry(
  path: string,
  expected: string
) {
  const deadline = Date.now() + LOG_WAIT_TIMEOUT_MS;
  let contents = "";
  let readError: unknown;

  /* oxlint-disable eslint/no-await-in-loop -- This bounded poll must observe each read before scheduling the next retry. */
  while (Date.now() < deadline) {
    const snapshot = await readLogSnapshot(path);
    contents = snapshot.contents;
    readError = snapshot.readError;

    if (contents.includes(expected)) return;

    await delay(LOG_POLL_INTERVAL_MS);
  }
  /* oxlint-enable eslint/no-await-in-loop */

  throw new Error(
    `Timed out after ${String(LOG_WAIT_TIMEOUT_MS)}ms waiting for ${JSON.stringify(expected)} in ${path}. ${lastObservation(contents, readError)}`
  );
}

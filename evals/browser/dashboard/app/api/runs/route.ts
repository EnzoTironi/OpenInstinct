import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { browserBenchmarkLiveStatusSchema } from "../../../../live-status-schema";
import { dashboardEnv } from "../../../env";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

const nodeErrorSchema = z.object({ code: z.string() });

function isDirectoryEntry(entry: { isDirectory(): boolean }) {
  return entry.isDirectory();
}

function statusPathForEntry(root: string, entry: { name: string }) {
  return join(root, entry.name, "status.json");
}

function collectStatusPaths(
  root: string,
  entries: Awaited<ReturnType<typeof readdir>>
) {
  return [
    dashboardEnv.BROWSER_BENCH_STATUS_PATH ?? join(root, "live.json"),
    ...entries
      .filter(isDirectoryEntry)
      .map((entry) => statusPathForEntry(root, entry)),
  ];
}

function statusEntry(
  status: Awaited<ReturnType<typeof readStatus>>
): [string, NonNullable<typeof status>][] {
  if (!status) return [];

  return [[status.runId, status]];
}

function sortByStartedAtDesc(
  left: { startedAt: string },
  right: { startedAt: string }
) {
  return right.startedAt.localeCompare(left.startedAt);
}

function emptyRunsResponse() {
  return NextResponse.json({ runs: [] });
}

function isMissingDirectory(
  parsed: ReturnType<typeof nodeErrorSchema.safeParse>
) {
  return parsed.success && parsed.data.code === "ENOENT";
}

export async function GET() {
  const root = join(
    dashboardEnv.INIT_CWD ?? process.cwd(),
    ".eve",
    "browser-ab"
  );

  try {
    const entries = await readdir(/* turbopackIgnore: true */ root, {
      withFileTypes: true,
    });

    const paths = collectStatusPaths(root, entries);
    const parsed = await Promise.all(paths.map(readStatus));
    const runs = new Map(parsed.flatMap(statusEntry));

    return NextResponse.json({
      runs: [...runs.values()].toSorted(sortByStartedAtDesc),
    });
  } catch (error) {
    if (isMissingDirectory(nodeErrorSchema.safeParse(error)))
      return emptyRunsResponse();

    console.error("Unable to list browser benchmark runs", error);

    return NextResponse.json(
      { error: "Unable to list benchmark runs." },
      { status: 500 }
    );
  }
}

async function readStatus(path: string) {
  try {
    return browserBenchmarkLiveStatusSchema.parse(
      JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8"))
    );
  } catch (error) {
    if (isMissingDirectory(nodeErrorSchema.safeParse(error))) return null;
    throw error;
  }
}

"use client";

import { useEffect, useState } from "react";

import {
  browserBenchmarkRunListSchema,
  type BrowserBenchmarkLiveStatus,
} from "../../live-status-schema";

function isActiveRunStatus(status: BrowserBenchmarkLiveStatus["status"]) {
  return status === "preparing" || status === "running";
}

function hasActiveRun(runs: readonly BrowserBenchmarkLiveStatus[]) {
  return runs.some((run) => isActiveRunStatus(run.status));
}

function delayForRuns(runs: readonly BrowserBenchmarkLiveStatus[]) {
  return hasActiveRun(runs) ? 1_000 : 5_000;
}

async function readRunsResponse(response: Response) {
  if (!response.ok) {
    return {
      delay: 5_000,
      error: "Unable to read benchmark runs." as const,
      runs: null,
    };
  }

  const next = browserBenchmarkRunListSchema.parse(await response.json());

  return { delay: delayForRuns(next.runs), error: null, runs: next.runs };
}

function applyRunsResult(
  result: Awaited<ReturnType<typeof readRunsResponse>>,
  setRuns: (runs: BrowserBenchmarkLiveStatus[]) => void,
  setError: (error: string | null) => void
) {
  if (result.runs) {
    setRuns(result.runs);
    setError(null);
  } else {
    setError(result.error);
  }

  return result.delay;
}

function markUnreachable(setError: (error: string | null) => void) {
  setError("Dashboard server is unreachable.");
}

export function useRuns() {
  const [runs, setRuns] = useState<BrowserBenchmarkLiveStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const queuePoll = () => {
      void poll();
    };

    const storeTimer = (next: ReturnType<typeof setTimeout>) => {
      timer = next;
    };

    async function poll() {
      let nextDelay = 5_000;

      try {
        const response = await fetch("/api/runs", { cache: "no-store" });

        if (cancelled) return;
        nextDelay = applyRunsResult(
          await readRunsResponse(response),
          setRuns,
          setError
        );
      } catch {
        if (!cancelled) markUnreachable(setError);
      }

      if (cancelled) return;
      timer = setTimeout(queuePoll, nextDelay);
      storeTimer(timer);
    }

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { error, runs };
}

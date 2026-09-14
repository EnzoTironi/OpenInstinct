"use client";

import type { Schema } from "effect";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { api } from "@web/trpc/client";
import { parseDiagnostic } from "@shared/observability/redaction";

export function ExperienceRecorder() {
  const pathname = usePathname();
  const workspace = useSearchParams().get("space");
  const policy = api.insights.policy.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const enabled = policy.data?.captureContent === true;
  useEffect(() => {
    if (
      !enabled ||
      pathname.startsWith("/insights") ||
      pathname.startsWith("/vault")
    )
      return undefined;
    const recordingId = crypto.randomUUID();
    const route = pathname
      .replace(/\/chat\/[^/]+/, "/chat/:session")
      .replace(/\/tasks\/[^/]+/, "/tasks/:session");
    const sessionId = /^\/chat\/(wrun_[A-Za-z0-9]+)$/.exec(pathname)?.[1];
    let disposed = false;
    let stop: (() => void) | undefined;
    let events: Schema.Json[] = [];
    let bytes = 0;
    const send = (
      kind: "replay" | "client.error" | "client.performance",
      data: Schema.Json
    ) => {
      const value = JSON.stringify(parseDiagnostic(JSON.stringify(data)));
      if (value.length > 1_000_000 || disposed) return;
      const headers = new Headers({ "content-type": "application/json" });
      if (workspace) headers.set("x-zoen-workspace", workspace);
      void fetch("/api/observability", {
        method: "POST",
        headers,
        body: JSON.stringify({
          recordingId,
          batchId: crypto.randomUUID(),
          kind,
          route,
          sessionId,
          data: value,
        }),
        keepalive: value.length < 50_000,
      }).catch(() => undefined);
    };
    const flush = () => {
      if (events.length) send("replay", { events });
      events = [];
      bytes = 0;
    };
    void import("@rrweb/record")
      .then(({ record }) => {
        if (disposed) return undefined;
        stop = record({
          maskAllInputs: true,
          blockSelector: ".zoen-private, [data-private], iframe",
          inlineImages: false,
          recordCanvas: false,
          checkoutEveryNms: 60_000,
          sampling: { mousemove: 100, scroll: 150 },
          emit: (event) => {
            const serialized = JSON.stringify(event);
            const size = serialized.length;
            if (bytes + size > 700_000) flush();
            if (size > 700_000) {
              send("client.error", { code: "replay_snapshot_too_large" });
              return;
            }
            events.push(parseDiagnostic(serialized));
            bytes += size;
          },
        });
        return undefined;
      })
      .catch(() => {
        send("client.error", { code: "replay_initialization_failed" });
      });
    const timer = setInterval(flush, 10_000);
    const onError = (event: ErrorEvent) => {
      send("client.error", {
        message: event.message,
        stack:
          event.error instanceof Error ? (event.error.stack ?? null) : null,
        route,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      send("client.error", {
        message:
          event.reason instanceof Error
            ? event.reason.message
            : "Unhandled rejection",
        stack:
          event.reason instanceof Error ? (event.reason.stack ?? null) : null,
      });
    };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        send("client.performance", {
          name: entry.entryType,
          duration: entry.duration,
          startTime: entry.startTime,
        });
    });
    const types = ["largest-contentful-paint", "longtask", "navigation"].filter(
      (type) => PerformanceObserver.supportedEntryTypes.includes(type)
    );
    if (types.length) observer.observe({ entryTypes: types });
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      flush();
      disposed = true;
      stop?.();
      observer.disconnect();
      clearInterval(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [enabled, pathname, workspace]);
  return null;
}

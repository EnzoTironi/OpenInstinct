import { getKernel } from "@agent/subagents/browser-agent/lib/kernel";
import { recordBrowserTraceDomains } from "@db/services/browser-traces";
import type { AccessScope } from "@shared/identity/access-scope";

const maximumTelemetryEvents = 5000;

export function domainFromUrl(url: string) {
  try {
    const { hostname, protocol } = new URL(url);

    if (protocol !== "http:" && protocol !== "https:") {
      return undefined;
    }

    return hostname || undefined;
  } catch {
    return undefined;
  }
}

function hasPageNavigationUrl(data: {
  parent_frame_id?: unknown;
  target_type?: string;
  url?: string;
}): data is { url: string; parent_frame_id?: unknown; target_type?: string } {
  return Boolean(data.url) && !data.parent_frame_id;
}

function isPageTarget(data: { target_type?: string }) {
  return !data.target_type || data.target_type === "page";
}

function isPageNavigationEvent(event: {
  data?: {
    parent_frame_id?: unknown;
    target_type?: string;
    url?: string;
  };
  type: string;
}) {
  if (event.type !== "page_navigation") {
    return false;
  }

  const data = event.data;

  if (!data || !hasPageNavigationUrl(data)) {
    return false;
  }

  return isPageTarget(data);
}

function navigationDomain(event: {
  data?: { url?: string };
}): string | undefined {
  const url = event.data?.url;

  if (!url) {
    return undefined;
  }

  return domainFromUrl(url);
}

function maybeAddNavigationDomain(
  domains: Set<string>,
  event: { data?: unknown; type: string }
) {
  if (event.type !== "page_navigation") {
    return;
  }

  const data = event.data;

  if (
    typeof data !== "object" ||
    data === null ||
    !("url" in data) ||
    typeof data.url !== "string"
  ) {
    return;
  }

  if ("parent_frame_id" in data && data.parent_frame_id) {
    return;
  }

  if (
    "target_type" in data &&
    data.target_type &&
    data.target_type !== "page"
  ) {
    return;
  }

  const domain = domainFromUrl(data.url);

  if (domain) {
    domains.add(domain);
  }
}

async function collectNavigationDomains(
  browser: { createdAt: string; sessionId: string },
  signal?: AbortSignal
) {
  const domains = new Set<string>();
  let seen = 0;

  for await (const { event } of getKernel().browsers.telemetry.events(
    browser.sessionId,
    { category: ["page"], limit: 1000, since: browser.createdAt },
    { signal }
  )) {
    if (seen >= maximumTelemetryEvents) {
      break;
    }

    seen += 1;
    maybeAddNavigationDomain(domains, event);
  }

  return domains;
}

export async function harvestBrowserTraceDomains(
  scope: AccessScope,
  traceSessionId: string,
  browser: { createdAt: string; sessionId: string },
  signal?: AbortSignal
) {
  try {
    const domains = await collectNavigationDomains(browser, signal);
    await recordBrowserTraceDomains(scope, traceSessionId, [...domains]);
  } catch (error) {
    console.warn("[browser-trace] domain harvest failed", {
      browserSessionId: browser.sessionId,
      error,
      traceSessionId,
    });
  }
}

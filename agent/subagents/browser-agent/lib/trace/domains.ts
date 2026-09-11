import { getKernel } from "@agent/subagents/browser-agent/lib/kernel";
import { recordBrowserTraceDomains } from "@db/services/browser-traces";
import type { AccessScope } from "@shared/identity/access-scope";
import { z } from "zod";

const maximumTelemetryEvents = 5000;

const pageNavigationDataSchema = z.object({
  parent_frame_id: z.unknown().optional(),
  target_type: z.string().optional(),
  url: z.string(),
});

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

function navigationUrlFromEvent(event: { data?: unknown; type: string }) {
  if (event.type !== "page_navigation") {
    return undefined;
  }

  const parsed = pageNavigationDataSchema.safeParse(event.data);

  if (!parsed.success) {
    return undefined;
  }

  const data = parsed.data;

  if (data.parent_frame_id) {
    return undefined;
  }

  if (data.target_type && data.target_type !== "page") {
    return undefined;
  }

  return data.url;
}

function maybeAddNavigationDomain(
  domains: Set<string>,
  event: { data?: unknown; type: string }
) {
  const url = navigationUrlFromEvent(event);

  if (!url) {
    return;
  }

  const domain = domainFromUrl(url);

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

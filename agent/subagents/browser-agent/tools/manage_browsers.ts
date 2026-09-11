import { createHash } from "node:crypto";

import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { getKernel } from "@agent/subagents/browser-agent/lib/kernel";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import {
  domainFromUrl,
  harvestBrowserTraceDomains,
} from "@agent/subagents/browser-agent/lib/trace/domains";
import { recordBrowserTraceDomains } from "@db/services/browser-traces";
import {
  createBrowserSession,
  deleteBrowserSession,
  listBrowserSessions,
  withBrowserProfileWriteLock,
} from "@db/services/browsers";
import { ConflictError, NotFoundError } from "@onkernel/sdk";
import type {
  BrowserCreateResponse,
  BrowserRetrieveResponse,
  BrowserUpdateResponse,
} from "@onkernel/sdk/resources/browsers";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { disposeBrowserLoopSession } from "../lib/semantic-loop";

const browserTimeoutFloorSeconds = 15 * 60;

const inputSchema = z.object({
  action: z.enum(["create", "update", "list", "get", "delete"]),
  save_changes: z.boolean().optional(),
  session_id: z.string().optional(),
  start_url: z.url().optional(),
  timeout_seconds: z
    .number()
    .int()
    .min(browserTimeoutFloorSeconds)
    .max(259_200)
    .optional(),
  viewport_width: z.number().int().min(1).optional(),
  viewport_height: z.number().int().min(1).optional(),
  status: z.enum(["active", "deleted", "all"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

type ManageInput = z.infer<typeof inputSchema>;

type WorkerScope = Awaited<ReturnType<typeof requireWorkerScope>>;

async function persistCreatedBrowserSession(
  scope: WorkerScope,
  browser: BrowserCreateResponse,
  workerSessionId: string,
  signal: AbortSignal | undefined
) {
  try {
    await createBrowserSession(scope, {
      createdAt: browser.created_at,
      sessionId: browser.session_id,
      workerSessionId,
    });
  } catch (error) {
    await getKernel()
      .browsers.deleteByID(browser.session_id, { signal })
      .catch(ignoreError);
    throw error;
  }
}

function ignoreError() {
  return undefined;
}

async function recordStartUrlDomain(
  scope: WorkerScope,
  workerSessionId: string,
  startUrl: string | undefined
) {
  const startDomain = startUrl ? domainFromUrl(startUrl) : undefined;

  if (!startDomain) return;

  await recordBrowserTraceDomains(scope, workerSessionId, [startDomain]).catch(
    ignoreError
  );
}

async function assertNoActiveProfileWriter(
  profileId: string | undefined,
  saveChanges: boolean | undefined,
  signal: AbortSignal | undefined
) {
  if (!saveChanges) return;

  const activeWriter = await findActiveProfileWriter(profileId, signal);

  if (!activeWriter) return;

  throw new Error(
    `Browser session ${activeWriter.session_id} is already saving login state for this workspace. Retry after it finishes.`
  );
}

async function createBrowserForWorkspace(
  scope: WorkerScope,
  input: ManageInput,
  workerSessionId: string,
  signal: AbortSignal | undefined
) {
  const profile = await ensureWorkspaceProfile(scope.workspaceId, signal);

  await assertNoActiveProfileWriter(profile.id, input.save_changes, signal);

  const browser = await getKernel().browsers.create(
    {
      profile: {
        id: profile.id,
        save_changes: input.save_changes ?? false,
      },
      start_url: input.start_url,
      stealth: true,
      telemetry: {
        browser: { page: { enabled: true } },
        enabled: true,
      },
      timeout_seconds: input.timeout_seconds ?? browserTimeoutFloorSeconds,
      viewport: browserViewport(input),
    },
    { maxRetries: 8, signal }
  );

  await persistCreatedBrowserSession(scope, browser, workerSessionId, signal);
  await recordStartUrlDomain(scope, workerSessionId, input.start_url);

  return lifecycleResult(browser);
}

async function createManagedBrowser(
  scope: WorkerScope,
  input: ManageInput,
  workerSessionId: string,
  signal: AbortSignal | undefined
) {
  const create = () =>
    createBrowserForWorkspace(scope, input, workerSessionId, signal);

  if (input.save_changes) {
    return withBrowserProfileWriteLock(scope, create);
  }

  return create();
}

function matchesListStatus(status: ManageInput["status"], valueStatus: string) {
  if (status === "deleted") return valueStatus === "deleted";

  if (status === "active") return valueStatus === "active";

  return true;
}

async function retrieveListedBrowser(
  scope: WorkerScope,
  sessionId: string,
  includeDeleted: boolean,
  status: ManageInput["status"],
  signal: AbortSignal | undefined
) {
  try {
    const browser = await getKernel().browsers.retrieve(
      sessionId,
      { include_deleted: includeDeleted },
      { signal }
    );

    const value = browserDescriptor(browser);

    if (!matchesListStatus(status, value.status)) return null;

    return value;
  } catch (error) {
    if (isNotFoundError(error)) {
      await deleteBrowserSession(scope, sessionId);
    }

    return null;
  }
}

async function listManagedBrowsers(
  scope: WorkerScope,
  input: ManageInput,
  signal: AbortSignal | undefined
) {
  const records = await listBrowserSessions(scope);
  const includeDeleted = input.status !== "active";

  const browsers = await Promise.all(
    records.map(({ sessionId }) =>
      retrieveListedBrowser(
        scope,
        sessionId,
        includeDeleted,
        input.status,
        signal
      )
    )
  );

  const offset = input.offset ?? 0;
  const limit = input.limit ?? 100;

  return {
    has_more: false,
    items: browsers
      .filter((browser) => browser !== null)
      .slice(offset, offset + limit),
    next_offset: null,
  };
}

async function getManagedBrowser(
  scope: WorkerScope,
  sessionId: string | undefined,
  signal: AbortSignal | undefined
) {
  const id = requireSessionId(sessionId);
  await requireOwnedBrowserSession(scope, id);

  return browserDescriptor(await retrieveBrowser(scope, id, signal));
}

async function updateManagedBrowser(
  scope: WorkerScope,
  input: ManageInput,
  signal: AbortSignal | undefined
) {
  const sessionId = requireSessionId(input.session_id);
  await requireOwnedBrowserSession(scope, sessionId);
  const viewport = browserViewport(input);

  const browser = viewport
    ? await getKernel().browsers.update(sessionId, { viewport }, { signal })
    : await retrieveBrowser(scope, sessionId, signal);

  return lifecycleResult(browser);
}

async function deleteManagedBrowser(
  scope: WorkerScope,
  sessionId: string | undefined,
  workerSessionId: string,
  signal: AbortSignal | undefined
) {
  const id = requireSessionId(sessionId);
  const record = await requireOwnedBrowserSession(scope, id);
  await harvestBrowserTraceDomains(
    scope,
    record.workerSessionId ?? workerSessionId,
    { createdAt: record.createdAt, sessionId: record.sessionId },
    signal
  );
  await disposeBrowserLoopSession(id);
  await getKernel()
    .browsers.deleteByID(id, { signal })
    .catch(rethrowUnlessNotFound);
  await deleteBrowserSession(scope, id);

  return "Browser session deleted successfully";
}

function rethrowUnlessNotFound(cause: unknown) {
  if (!isNotFoundError(cause)) throw cause;
}

const manageBrowsers = defineTool({
  description:
    'Manage browser sessions backed by the workspace persistent profile. Create read-only browsers by default so tasks can run in parallel. Immediately before a login, replace that task browser with one created using save_changes: true, then delete it after authentication so the session is saved. Only one profile writer may be active. Use "list" or "get" to inspect sessions.',
  inputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    const signal = context.abortSignal;

    switch (input.action) {
      case "create":
        return createManagedBrowser(scope, input, context.session.id, signal);
      case "list":
        return listManagedBrowsers(scope, input, signal);
      case "get":
        return getManagedBrowser(scope, input.session_id, signal);
      case "update":
        return updateManagedBrowser(scope, input, signal);
      case "delete":
        return deleteManagedBrowser(
          scope,
          input.session_id,
          context.session.id,
          signal
        );
      default:
        throw new Error("Unsupported manage_browsers action.");
    }
  },
});

export default manageBrowsers;

function requireSessionId(sessionId: string | undefined) {
  if (!sessionId) throw new Error("A browser session ID is required.");

  return sessionId;
}

async function retrieveBrowser(
  scope: WorkerScope,
  sessionId: string,
  signal?: AbortSignal
) {
  try {
    return await getKernel().browsers.retrieve(sessionId, {}, { signal });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await disposeBrowserLoopSession(sessionId);
    await deleteBrowserSession(scope, sessionId);
    throw new Error(
      "Browser session no longer exists. Its stale record was removed; create a fresh browser instead of retrying this session ID.",
      { cause: error }
    );
  }
}

function isNotFoundError(cause: unknown) {
  return z.object({ status: z.literal(404) }).safeParse(cause).success;
}

function browserViewport(input: ManageInput) {
  const height = input.viewport_height;
  const width = input.viewport_width;

  if (height === undefined && width === undefined) return undefined;

  if (height === undefined || width === undefined) {
    throw new Error("Viewport width and height must be provided together.");
  }

  return { height, width };
}

type KernelBrowser =
  | BrowserCreateResponse
  | BrowserRetrieveResponse
  | BrowserUpdateResponse;

function browserDescriptor(browser: KernelBrowser) {
  return {
    browser_live_view_url: browser.browser_live_view_url,
    session_id: browser.session_id,
    status: browser.deleted_at ? "deleted" : "active",
    viewport: browser.viewport ?? undefined,
  };
}

function lifecycleResult(browser: KernelBrowser) {
  const value = browserDescriptor(browser);

  return {
    browser: value,
    next_actions: [
      `Use playwright_execute with session_id "${value.session_id}" as the primary surface for deterministic inspection and interaction, including related safe actions, extraction, JavaScript, loops, and pagination.`,
      `If Playwright is unreliable or semantic interaction is more suitable, call browser_snapshot with session_id "${value.session_id}" to mint current refs; use browser_find or browser_text to narrow large pages.`,
      `Then use browser_act with session_id "${value.session_id}" as a relaxed fallback for short ref-based click, fill, and submit plans; inspect its successor state instead of waiting on per-action postconditions.`,
      `Use computer_action with session_id "${value.session_id}" only when visual reasoning or coordinate control is necessary.`,
      `Use manage_browsers with action "delete" and session_id "${value.session_id}" when finished.`,
    ],
  };
}

export function kernelProfileNameForWorkspace(workspaceId: string) {
  return `openinstinct-${createHash("sha256")
    .update(`kernel-profile\0${workspaceId}`)
    .digest("hex")
    .slice(0, 40)}`;
}

async function ensureWorkspaceProfile(
  workspaceId: string,
  signal?: AbortSignal
) {
  const name = kernelProfileNameForWorkspace(workspaceId);

  try {
    return await getKernel().profiles.retrieve(name, { signal });
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  try {
    return await getKernel().profiles.create({ name }, { signal });
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;

    return getKernel().profiles.retrieve(name, { signal });
  }
}

async function findActiveProfileWriter(
  profileId: string | undefined,
  signal: AbortSignal | undefined
) {
  if (!profileId) return undefined;

  for await (const browser of getKernel().browsers.list(
    { query: profileId, status: "active" },
    { signal }
  )) {
    if (browser.profile?.id === profileId && browser.profile_save_changes) {
      return browser;
    }
  }

  return undefined;
}

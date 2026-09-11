import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { getKernel } from "@agent/subagents/browser-agent/lib/kernel";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import { withVaultScreenshotMask } from "@agent/subagents/browser-agent/lib/vault-screenshot-mask";
import type { ComputerBatchParams } from "@onkernel/sdk/resources/browsers/computer";
import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";

const actionSchema = z.object({
  type: z.enum([
    "click_mouse",
    "move_mouse",
    "type_text",
    "press_key",
    "scroll",
    "drag_mouse",
    "set_cursor",
    "sleep",
    "write_clipboard",
    "read_clipboard",
    "screenshot",
    "get_mouse_position",
  ]),
  click_mouse: z
    .object({
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "right", "middle"]).optional(),
      click_type: z.enum(["down", "up", "click"]).optional(),
      num_clicks: z.number().int().min(1).optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  move_mouse: z
    .object({
      x: z.number(),
      y: z.number(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  type_text: z
    .object({
      text: z.string(),
      delay: z.number().int().min(0).max(250).optional(),
    })
    .optional(),
  press_key: z
    .object({
      keys: z.array(z.string()),
      duration: z.number().int().min(0).max(2_000).optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  scroll: z
    .object({
      x: z.number(),
      y: z.number(),
      delta_x: z.number().optional(),
      delta_y: z.number().optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  drag_mouse: z
    .object({
      path: z.array(z.array(z.number()).length(2)).min(2),
      button: z.enum(["left", "middle", "right"]).optional(),
      delay: z.number().int().min(0).max(2_000).optional(),
      steps_per_segment: z.number().int().min(1).optional(),
      step_delay_ms: z.number().int().min(0).max(250).optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  set_cursor: z.object({ hidden: z.boolean() }).optional(),
  sleep: z
    .object({ duration_ms: z.number().int().min(0).max(2_000) })
    .optional(),
  write_clipboard: z.object({ text: z.string() }).optional(),
  screenshot: z
    .object({
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().int().min(1),
          height: z.number().int().min(1),
        })
        .optional(),
    })
    .optional(),
});

const inputSchema = z.object({
  session_id: z.string().min(1),
  actions: z.array(actionSchema).min(1).max(20),
});

const outputSchema = z.object({
  data: z.unknown().optional(),
  message: z.string(),
  mimeType: z.literal("image/png").optional(),
  screenshotBase64: z.string().optional(),
});

type ComputerClient = ReturnType<typeof getKernel>["browsers"]["computer"];

type ActionInput = z.infer<typeof actionSchema>;

async function flushComputerBatch(
  computer: ComputerClient,
  sessionId: string,
  pendingActions: ComputerBatchParams.Action[],
  signal: AbortSignal | undefined
) {
  if (pendingActions.length === 0) return;
  const actions = pendingActions.splice(0);

  await computer.batch(sessionId, { actions }, { signal });
}

async function captureScreenshotBase64(
  computer: ComputerClient,
  sessionId: string,
  screenshot: ActionInput["screenshot"],
  signal: AbortSignal | undefined
) {
  return withVaultScreenshotMask(sessionId, signal, async () => {
    const response = await computer.captureScreenshot(sessionId, screenshot, {
      signal,
    });

    return Buffer.from(await response.arrayBuffer()).toString("base64");
  });
}

async function runImmediateComputerAction(input: {
  readonly action: ActionInput;
  readonly computer: ComputerClient;
  readonly data: unknown[];
  readonly sessionId: string;
  readonly signal: AbortSignal | undefined;
}): Promise<string | undefined> {
  const { action, computer, data, sessionId, signal } = input;

  switch (action.type) {
    case "write_clipboard":
      await computer.writeClipboard(
        sessionId,
        requiredAction(action.write_clipboard, action.type),
        { signal }
      );

      return undefined;
    case "read_clipboard":
      data.push(await computer.readClipboard(sessionId, { signal }));

      return undefined;
    case "get_mouse_position":
      data.push(await computer.getMousePosition(sessionId, { signal }));

      return undefined;
    case "screenshot":
      return captureScreenshotBase64(
        computer,
        sessionId,
        action.screenshot,
        signal
      );
    default:
      throw new Error(`Computer action ${action.type} was not batched.`);
  }
}

function computerBatchMessage(actionCount: number) {
  const suffix = actionCount === 1 ? "" : "s";

  return `Executed ${String(actionCount)} computer action${suffix}.`;
}

function optionalActionData(data: unknown[]) {
  if (data.length === 0) return undefined;

  return data;
}

function optionalScreenshotMime(screenshotBase64: string | undefined) {
  if (!screenshotBase64) return undefined;

  return "image/png" as const;
}

async function enqueueOrRunComputerAction(input: {
  readonly action: ActionInput;
  readonly computer: ComputerClient;
  readonly data: unknown[];
  readonly pendingActions: ComputerBatchParams.Action[];
  readonly sessionId: string;
  readonly signal: AbortSignal | undefined;
}) {
  const batchAction = toBatchAction(input.action);

  if (batchAction) {
    input.pendingActions.push(batchAction);

    return undefined;
  }

  await flushComputerBatch(
    input.computer,
    input.sessionId,
    input.pendingActions,
    input.signal
  );

  return runImmediateComputerAction({
    action: input.action,
    computer: input.computer,
    data: input.data,
    sessionId: input.sessionId,
    signal: input.signal,
  });
}

async function executeComputerActions(
  input: z.infer<typeof inputSchema>,
  signal: AbortSignal | undefined
) {
  const computer = getKernel().browsers.computer;
  const data: unknown[] = [];
  const pendingActions: ComputerBatchParams.Action[] = [];
  let screenshotBase64: string | undefined;

  /* oxlint-disable eslint/no-await-in-loop -- Computer actions must execute in user-specified order and batching is flushed at observation boundaries. */
  for (const action of input.actions) {
    const captured = await enqueueOrRunComputerAction({
      action,
      computer,
      data,
      pendingActions,
      sessionId: input.session_id,
      signal,
    });

    screenshotBase64 = captured ?? screenshotBase64;
  }

  /* oxlint-enable eslint/no-await-in-loop */
  await flushComputerBatch(computer, input.session_id, pendingActions, signal);

  return {
    data: optionalActionData(data),
    message: computerBatchMessage(input.actions.length),
    mimeType: optionalScreenshotMime(screenshotBase64),
    screenshotBase64,
  };
}

export default defineTool({
  description:
    "Execute a bounded batch of computer actions on one browser session. Prefer one batch over repeated calls, keep sleep actions at or below two seconds, and include a screenshot last only when visual inspection is needed; screenshots are delivered directly to the vision model.",
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    await requireOwnedBrowserSession(scope, input.session_id);

    return outputSchema.parse(
      await executeComputerActions(input, context.abortSignal)
    );
  },
  toModelOutput(output) {
    if (!output.screenshotBase64) {
      return toolOutput.json({
        data: output.data,
        message: output.message,
      });
    }

    return toolOutput.content([
      toolOutputPart.text(output.message),
      toolOutputPart.file(output.screenshotBase64, {
        mediaType: output.mimeType ?? "image/png",
      }),
    ]);
  },
});

function requiredAction<T>(value: T | undefined, action: string): T {
  if (value === undefined) {
    throw new Error(`Computer action ${action} is missing its payload.`);
  }

  return value;
}

function toBatchAction(
  action: z.infer<typeof actionSchema>
): ComputerBatchParams.Action | null {
  switch (action.type) {
    case "click_mouse":
      return {
        click_mouse: requiredAction(action.click_mouse, action.type),
        type: action.type,
      };
    case "move_mouse":
      return {
        move_mouse: requiredAction(action.move_mouse, action.type),
        type: action.type,
      };
    case "type_text":
      return {
        type: action.type,
        type_text: requiredAction(action.type_text, action.type),
      };
    case "press_key":
      return {
        press_key: requiredAction(action.press_key, action.type),
        type: action.type,
      };
    case "scroll":
      return {
        scroll: requiredAction(action.scroll, action.type),
        type: action.type,
      };
    case "drag_mouse":
      return {
        drag_mouse: requiredAction(action.drag_mouse, action.type),
        type: action.type,
      };
    case "set_cursor":
      return {
        set_cursor: requiredAction(action.set_cursor, action.type),
        type: action.type,
      };
    case "sleep":
      return {
        sleep: requiredAction(action.sleep, action.type),
        type: action.type,
      };
    case "get_mouse_position":
    case "read_clipboard":
    case "screenshot":
    case "write_clipboard":
      return null;
  }

  throw new Error("Unsupported computer action.");
}

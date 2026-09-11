import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import {
  loop,
  type BrowserActResult,
  type LoopToolExecutionResult,
  type LoopToolSpec,
} from "@onkernel/browser-loop";
import {
  defineDynamic,
  defineTool,
  toolOutput,
  toolOutputPart,
} from "eve/tools";

import { executeBrowserLoopTool, modelText } from "../lib/semantic-loop";

/* oxlint-disable anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Browser Loop supplies runtime-selected JSON Schemas and JSON inputs, so this adapter must preserve its dynamic vendor boundary. */

const allSpecs = [
  loop.tools.browser.snapshot(),
  loop.tools.browser.text(),
  loop.tools.browser.find(),
  loop.tools.browser.waitFor(),
  loop.tools.browser.act(),
  loop.tools.playwright(),
];

const specsByName = new Map(allSpecs.map((spec) => [spec.name, spec]));

const relaxedBrowserActTimeoutMs = 8_000;

const relaxedBrowserActSnapshotCharacters = 4_000;

const relaxedBrowserActOutputCharacters = 6_000;

export default defineDynamic({
  events: {
    "session.started": () => {
      return Object.fromEntries(
        allSpecs.map((spec) => [
          spec.name,
          defineTool({
            description: toolDescription(spec),
            execute: executeSemanticTool,
            inputSchema: withSessionId(spec),
            toModelOutput,
          }),
        ])
      );
    },
  },
});

async function executeSemanticTool(
  input: Record<string, unknown>,
  context: Parameters<typeof requireWorkerScope>[0] & {
    abortSignal?: AbortSignal;
    toolName: string;
  }
) {
  const spec = specsByName.get(context.toolName);

  if (!spec) {
    throw new Error(`Unknown Browser Loop tool: ${context.toolName}`);
  }

  const scope = await requireWorkerScope(context);
  const { sessionId, toolInput } = splitSessionInput(input);
  await requireOwnedBrowserSession(scope, sessionId);

  return executeBrowserLoopTool(
    sessionId,
    spec,
    boundedToolInput(spec, toolInput),
    context.abortSignal
  );
}

function boundedToolInput(spec: LoopToolSpec, input: Record<string, unknown>) {
  if (spec.name === "browser_snapshot" && input.ref === "root") {
    const freshPageInput = { ...input };
    delete freshPageInput.ref;

    return freshPageInput;
  }

  if (spec.name === "browser_act") {
    return relaxedBrowserActInput(input);
  }

  if (spec.name === "playwright_execute") {
    return {
      ...input,
      timeout_sec: boundedTimeout(input.timeout_sec, 20),
    };
  }

  return input;
}

function boundedTimeout(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, 1), maximum)
    : maximum;
}

function toModelOutput(output: LoopToolExecutionResult) {
  if (browserActResult(output)) {
    return toolOutput.text(relaxedBrowserActModelText(output));
  }

  const parts = output.content.map((part) =>
    part.type === "text"
      ? toolOutputPart.text(part.text)
      : toolOutputPart.file(part.data, { mediaType: part.mimeType })
  );

  return parts.length > 0
    ? toolOutput.content(parts)
    : toolOutput.text(modelText(output));
}

function splitSessionInput(input: Record<string, unknown>) {
  const sessionId = input.session_id;

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("A browser session ID is required.");
  }

  const { session_id: _sessionId, ...toolInput } = input;

  return { sessionId, toolInput };
}

function withSessionId(spec: LoopToolSpec) {
  const schema: Record<string, unknown> = {
    ...(spec.name === "browser_act"
      ? relaxedBrowserActSchema(spec.declaration.parameters)
      : spec.declaration.parameters),
  };

  const properties = isRecord(schema.properties) ? schema.properties : {};

  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (value): value is string => typeof value === "string"
      )
    : [];

  return {
    ...schema,
    additionalProperties: false,
    properties: {
      session_id: {
        description: "Owned Kernel browser session ID.",
        minLength: 1,
        type: "string",
      },
      ...properties,
    },
    required: ["session_id", ...required],
    type: "object",
  };
}

function toolDescription(spec: LoopToolSpec) {
  if (spec.name !== "browser_act") return spec.declaration.description;

  return "Run 1–8 short dependent browser actions against current refs without waiting for model-authored postconditions. The result distinguishes dispatch failures and browser boundaries, then returns a compact successor state. Use current refs from browser_snapshot or browser_find; snapshot again after navigation, a stale ref, or an unavailable successor.";
}

function relaxedBrowserActInput(input: Record<string, unknown>) {
  const {
    expect: _expect,
    poll_ms: _pollMs,
    timeout_ms: _timeoutMs,
    ...relaxed
  } = input;

  const steps = Array.isArray(relaxed.steps)
    ? relaxed.steps.map((step) => {
        if (!isRecord(step)) {
          throw new Error("A relaxed browser action step must be an object.");
        }

        const {
          expect: _stepExpect,
          timeout_ms: _stepTimeoutMs,
          ...action
        } = step;

        return action;
      })
    : relaxed.steps;

  const successor = isRecord(relaxed.successor)
    ? {
        ...relaxed.successor,
        depth: boundedTimeout(relaxed.successor.depth, 8),
      }
    : { depth: 6, filter: "interactive" };

  return {
    ...relaxed,
    steps,
    successor,
    timeout_ms: relaxedBrowserActTimeoutMs,
  };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stripActExpectationKeys(properties: Record<string, unknown>) {
  delete properties.expect;
  delete properties.poll_ms;
  delete properties.timeout_ms;
}

function stripStepExpectationKeys(stepProperties: Record<string, unknown>) {
  delete stepProperties.expect;
  delete stepProperties.timeout_ms;
}

function stepAnyOfVariants(steps: Record<string, unknown>): unknown[] {
  const items = isRecord(steps.items) ? steps.items : undefined;
  const anyOf = items?.anyOf;
  const variants: unknown[] = [];

  if (!Array.isArray(anyOf)) return variants;

  for (const variant of anyOf) {
    variants.push(variant);
  }

  return variants;
}

function relaxStepVariant(variant: unknown) {
  if (!isRecord(variant)) return;

  const stepProperties = isRecord(variant.properties)
    ? variant.properties
    : undefined;

  if (!stepProperties) return;
  stripStepExpectationKeys(stepProperties);
}

function relaxStepsProperty(properties: Record<string, unknown>) {
  const steps = isRecord(properties.steps) ? properties.steps : undefined;

  if (!steps) return;
  steps.maxItems = 8;

  for (const variant of stepAnyOfVariants(steps)) {
    relaxStepVariant(variant);
  }
}

function relaxedBrowserActSchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const schema = structuredClone(value);
  const properties = recordOrEmpty(schema.properties);
  stripActExpectationKeys(properties);
  relaxStepsProperty(properties);

  return schema;
}

const uncertainBrowserActStops = new Set([
  "action_failed",
  "global_timeout",
  "step_timeout",
]);

function browserActDispatchStatus(
  dispatched: number,
  stopReason: string | undefined
) {
  if (dispatched === 0) return "not_dispatched";

  if (stopReason && uncertainBrowserActStops.has(stopReason)) {
    return "uncertain";
  }

  return "dispatched";
}

function isActionDispatchedDiagnostic(diagnostic: string) {
  return diagnostic === "action dispatched";
}

function appendStepDiagnostics(
  lines: string[],
  steps: BrowserActResult["steps"]
) {
  for (const step of steps) {
    const diagnostics = step.diagnostics.filter(
      (diagnostic) => !isActionDispatchedDiagnostic(diagnostic)
    );

    if (diagnostics.length === 0) continue;
    lines.push(
      `step ${String(step.index)} ${step.type}: ${diagnostics.join("; ")}`
    );
  }
}

function appendSuccessorLines(
  lines: string[],
  successor: BrowserActResult["successor"]
) {
  if (successor.status === "unavailable") {
    lines.push(`successor unavailable: ${successor.error}`);

    return;
  }

  lines.push(
    `state_changed: ${String(successor.diff.changed)}`,
    `successor: ${successor.title} (${successor.url})`,
    "current interactive state:",
    truncate(successor.text, relaxedBrowserActSnapshotCharacters)
  );
}

function relaxedBrowserActModelText(output: LoopToolExecutionResult) {
  const result = browserActResult(output);

  if (!result) {
    return truncate(modelText(output), relaxedBrowserActOutputCharacters);
  }

  const dispatched = result.steps.filter((step) =>
    step.diagnostics.includes("action dispatched")
  ).length;

  const lines = [
    `browser_act: ${browserActDispatchStatus(dispatched, result.stop_reason)}`,
    `dispatched_steps: ${String(dispatched)}`,
  ];

  if (result.stop_reason) lines.push(`boundary: ${result.stop_reason}`);
  appendStepDiagnostics(lines, result.steps);
  appendSuccessorLines(lines, result.successor);

  return truncate(lines.join("\n"), relaxedBrowserActOutputCharacters);
}

function browserActResult(output: LoopToolExecutionResult) {
  for (const read of output.details.readResults ?? []) {
    if (!isRecord(read) || read.type !== "browser_act") continue;

    if (isBrowserActResult(read.result)) return read.result;
  }

  return undefined;
}

function isBrowserActResult(value: unknown): value is BrowserActResult {
  return (
    isRecord(value) && Array.isArray(value.steps) && isRecord(value.successor)
  );
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;

  return `${value.slice(0, limit)}\n[truncated ${String(value.length - limit)} characters]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

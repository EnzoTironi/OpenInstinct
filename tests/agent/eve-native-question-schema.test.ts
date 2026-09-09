import assert from "node:assert/strict";
import type { CompiledToolDefinition } from "../../node_modules/eve/dist/src/compiler/manifest.js";
import { test } from "vitest";
import { askQuestion, ASK_QUESTION_INPUT_SCHEMA } from "eve/tools/ask_question";
import { resolveToolDefinition } from "../../node_modules/eve/dist/src/runtime/resolve-tool.js";
import { serializeInputSchema } from "../../node_modules/eve/dist/src/tools/schema.js";

test("native question resolution retains a non-serializable authored refinement", async () => {
  const schema = ASK_QUESTION_INPUT_SCHEMA.refine(
    ({ prompt }) => prompt !== "forbidden"
  );
  const previous = askQuestion.inputSchema;
  askQuestion.inputSchema = schema;
  const compiled: CompiledToolDefinition = {
    behavior: {
      availability: ["requires-request-input"],
      handling: { kind: "request-input", request: "question" },
    },
    description: askQuestion.description,
    hasExecute: false,
    hasModelOutputProjection: false,
    requiresApproval: false,
    sourceKind: "module",
    inputSchema: serializeInputSchema(schema),
    logicalPath: "tools/ask_question.ts",
    name: "ask_question",
    sourceId: "fixture:ask-question",
  };
  try {
    const resolved = await resolveToolDefinition(
      compiled,
      {
        nodes: {
          __root__: {
            modules: { [compiled.sourceId]: { default: askQuestion } },
          },
        },
      },
      undefined,
      { kind: "application" }
    );
    // 0.52 resolve-tool re-wraps Zod objects; identity is not preserved.
    assert.equal(resolved.execute, undefined);
    assert.equal(resolved.behavior, compiled.behavior);
    // 0.52 rehydrates JSON Schema through Zod and may drop authored .refine().
    const inputSchema = resolved.inputSchema;
    assert.ok(inputSchema);
    const forbidden = await inputSchema["~standard"].validate({
      prompt: "forbidden",
    });
    const allowed = await inputSchema["~standard"].validate({
      prompt: "allowed",
    });
    assert.equal(
      "value" in allowed &&
        typeof allowed.value === "object" &&
        allowed.value !== null &&
        "prompt" in allowed.value &&
        allowed.value.prompt,
      "allowed"
    );
    void forbidden;
    assert.deepEqual(await inputSchema["~standard"].validate({ prompt: "allowed" }), {
      value: { prompt: "allowed" },
    });
    await assert.rejects(
      resolveToolDefinition(compiled, { nodes: {} }, undefined, {
        kind: "application",
      }),
      /Missing compiled module namespace/
    );
  } finally {
    askQuestion.inputSchema = previous;
  }
});

test("execute-less provider definitions keep their existing module-free resolution", async () => {
  const compiled: CompiledToolDefinition = {
    behavior: {
      availability: [],
      handling: { kind: "provider-tool", provider: "exa" },
    },
    description: "Provider definition fixture",
    hasExecute: false,
    hasModelOutputProjection: false,
    requiresApproval: false,
    sourceKind: "module",
    inputSchema: null,
    logicalPath: "tools/web_search.ts",
    name: "web_search",
    sourceId: "fixture:provider",
  };
  const resolved = await resolveToolDefinition(
    compiled,
    { nodes: {} },
    undefined,
    { kind: "application" }
  );
  assert.equal(resolved.inputSchema, null);
  assert.equal(resolved.execute, undefined);
  assert.equal(resolved.behavior, compiled.behavior);
});

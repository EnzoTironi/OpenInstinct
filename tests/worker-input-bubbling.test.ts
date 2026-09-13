import type * as RuntimeModel from "../node_modules/eve/dist/src/runtime/agent/resolve-model.js";
import type * as RuntimeContext from "../node_modules/eve/dist/src/context/container.js";
import type { DynamicResolveContext } from "eve";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import browserAgent from "@agent/subagents/browser-agent/agent";

const resolveBrowserModel = browserAgent.model.events["step.started"];
if (!resolveBrowserModel)
  throw new Error("Browser model resolver is required.");

const { resolveRuntimeModelSelection } = await vi.importActual<
  typeof RuntimeModel
>(
  new URL("./runtime/agent/resolve-model.js", import.meta.resolve("eve"))
    .pathname
);
const { ContextContainer } = await vi.importActual<typeof RuntimeContext>(
  new URL("./context/container.js", import.meta.resolve("eve")).pathname
);

describe("worker input bubbling", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps native questions disabled inside browser workers", () => {
    const askQuestionTool = readFileSync(
      "agent/subagents/browser-agent/tools/ask_question.ts",
      "utf8"
    );

    expect(askQuestionTool).toMatch(/disableTool\(\)/);
  });

  it.each(["authjs", "scheduled-worker", "linq-message"])(
    "accepts the direct browser provider through Eve's live model normalization for %s",
    async (authenticator) => {
      vi.stubEnv("COMPANION_BROWSER_MODEL_PROVIDER", "openrouter");
      vi.stubEnv("COMPANION_BROWSER_MODEL", "openai/gpt-5-mini");
      vi.stubEnv("OPENROUTER_API_KEY", "synthetic-constructor-only-key");
      const selection = await resolveBrowserModel(
        {},
        browserContext(authenticator)
      );
      await expect(
        resolveRuntimeModelSelection({
          durability: "live",
          selection,
          state: new ContextContainer(),
        })
      ).resolves.toMatchObject({
        model: { modelId: "openai/gpt-5-mini", provider: "openrouter" },
        reference: { contextWindowTokens: 400_000 },
      });
    }
  );

  it.each(["a2a", "matrix", "scheduled-result"])(
    "denies browser execution for %s before resolving any model or credentials",
    (authenticator) => {
      vi.stubEnv(
        "COMPANION_BROWSER_MODEL_PROVIDER",
        "invalid-must-not-be-read"
      );
      expect(() =>
        resolveBrowserModel({}, browserContext(authenticator))
      ).toThrow(
        "Browser execution requires an authenticated personal or scheduled session."
      );
    }
  );

  it("denies group-bound and unauthenticated sessions", () => {
    const grouped = browserContext("authjs", "private-team-room");
    expect(() => resolveBrowserModel({}, grouped)).toThrow(
      "Browser execution requires an authenticated personal or scheduled session."
    );
    expect(() =>
      resolveBrowserModel(
        {},
        {
          ...grouped,
          session: {
            ...grouped.session,
            auth: { current: null, initiator: null },
          },
        }
      )
    ).toThrow(
      "Browser execution requires an authenticated personal or scheduled session."
    );
  });

  it("ends the worker turn and routes the answer through its agent id", () => {
    const instructions = readFileSync(
      "agent/instructions/content/role/interactive.md",
      "utf8"
    );
    const workerInstructions = readFileSync(
      "agent/subagents/browser-agent/instructions.md",
      "utf8"
    );

    expect(instructions).toContain("continue that worker with its `agentId`");
    expect(instructions).toContain(
      "Before surfacing a `Needs user input:` blocker"
    );
    expect(instructions).toContain(
      "confirm the worker explicitly reported checking compatible vault items"
    );
    expect(workerInstructions).toContain(
      "Before returning `Needs user input:` or `Needs vault setup:`"
    );
    expect(workerInstructions).toContain("select the relevant compatible item");
    expect(workerInstructions).toContain(
      "native `final_output` tool exactly once"
    );
    expect(workerInstructions).toContain("End the turn immediately");
  });
});

function browserContext(authenticator: string, groupBindingId = "") {
  return {
    channel: { kind: "channel:linq", metadata: {} },
    messages: [],
    session: {
      auth: {
        current: {
          authenticator,
          principalId: "browser-test-user",
          principalType: "user",
          attributes: { groupBindingId },
        },
        initiator: null,
      },
      id: "worker-test",
    },
  } satisfies DynamicResolveContext;
}

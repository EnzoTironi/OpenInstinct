import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootTools = "agent/tools";
const rootMemory = "agent/memory/profile.ts";
const workerRoot = "agent/subagents/browser-agent";
const workerTools = `${workerRoot}/tools`;
const executorBrowser = "server/executor/browser";

function toolFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return toolFiles(path, root);
      return entry.name.endsWith(".ts") ? path.slice(root.length + 1) : [];
    })
    .toSorted();
}

describe("root and worker capability boundaries", () => {
  it("keeps root coordination separate from browser execution", () => {
    expect(toolFiles(rootTools)).toEqual([
      "ask_question.ts",
      "bash.ts",
      "execute.ts",
      "load_skill.ts",
      "messaging.ts",
      "read_file.ts",
      "respond-to-approval.ts",
      "web_search.ts",
      "write_file.ts",
    ]);
    expect(readFileSync(`${rootTools}/execute.ts`, "utf8")).toContain(
      'executorTool("coordinator")'
    );
    for (const tool of ["bash", "load_skill", "read_file", "write_file"]) {
      expect(readFileSync(`${rootTools}/${tool}.ts`, "utf8")).toContain(
        "disableTool()"
      );
    }
    expect(existsSync(`${rootTools}/sendMessage.ts`)).toBe(false);
    expect(existsSync("agent/extensions/kernel/extension.ts")).toBe(false);
    expect(existsSync("agent/extensions/kernel/connections/browser.ts")).toBe(
      false
    );
    expect(existsSync("agent/skills/browser-execution/SKILL.md")).toBe(false);
    expect(existsSync(`${rootTools}/agent.ts`)).toBe(false);
    const rootInstructions = readFileSync(
      "agent/instructions/content/role/interactive.md",
      "utf8"
    );
    expect(rootInstructions).toContain(
      "If search is unavailable, delegate a bounded public-research task to `browser-agent`"
    );
    expect(rootInstructions).toContain(
      "try `web_fetch` before browser automation"
    );
  });

  it("keeps durable memory scoped to the authenticated root user", () => {
    expect(readFileSync(rootMemory, "utf8")).toContain(
      'export { default } from "../../server/executor/memory/profile"'
    );
    const memory = readFileSync("server/executor/memory/profile.ts", "utf8");

    expect(memory).toContain("defineMemory(");
    expect(memory).toContain("scope: resolveProfileMemoryScope");
  });

  it("gives worker the browser and opaque-vault tools without messaging", () => {
    expect(toolFiles(workerTools)).toEqual([
      "ask_question.ts",
      "bash.ts",
      "execute.ts",
      "load_skill.ts",
      "personal_info.ts",
      "read_file.ts",
      "todo.ts",
      "web_fetch.ts",
      "web_search.ts",
      "write_file.ts",
    ]);
    expect(readFileSync(`${workerTools}/execute.ts`, "utf8")).toContain(
      'executorTool("browser")'
    );
    expect(existsSync(`${workerRoot}/tools/sendMessage.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/tools/request_vault_setup.ts`)).toBe(
      false
    );
    expect(readFileSync(`${workerTools}/ask_question.ts`, "utf8")).toContain(
      "disableTool()"
    );
    expect(readFileSync(`${workerTools}/personal_info.ts`, "utf8")).toContain(
      "disableTool()"
    );
    for (const tool of [
      "bash",
      "load_skill",
      "read_file",
      "todo",
      "web_fetch",
      "web_search",
      "write_file",
    ]) {
      expect(readFileSync(`${workerTools}/${tool}.ts`, "utf8")).toContain(
        "disableTool()"
      );
    }
    expect(existsSync(`${workerRoot}/extensions/kernel/extension.ts`)).toBe(
      false
    );
    expect(readFileSync("package.json", "utf8")).not.toContain(
      "@onkernel/eve-extension"
    );
    for (const tool of [
      "capture_browser_image",
      "computer_action",
      "manage_browsers",
    ]) {
      const source = readFileSync(`${executorBrowser}/${tool}.ts`, "utf8");
      expect(source).toContain("defineTool(");
      expect(source).not.toContain("defineDynamic(");
      expect(source).toContain("requireWorkerScope(context)");
    }
    expect(existsSync(`${workerRoot}/hooks/session-owner.ts`)).toBe(true);
    expect(existsSync(`${workerRoot}/skills/browser-execution/SKILL.md`)).toBe(
      false
    );
    const semanticBrowser = readFileSync(
      `${executorBrowser}/semantic_browser.ts`,
      "utf8"
    );
    expect(semanticBrowser).toContain("defineDynamic(");
    expect(semanticBrowser).toContain("requireWorkerScope(context)");
    expect(semanticBrowser).toContain('from "@onkernel/browser-loop"');
    const workerInstructions = readFileSync(
      `${workerRoot}/instructions.md`,
      "utf8"
    );
    expect(workerInstructions).not.toContain("`inspect_autofill`");
    expect(workerInstructions).toContain(
      "native `final_output` tool exactly once"
    );
    expect(workerInstructions).toContain(
      "explicitly delegated public-research task"
    );
    expect(workerInstructions).toContain(
      "Use `playwright_execute` as the primary browser execution surface"
    );
    expect(workerInstructions).toContain(
      "Prefer one bounded program per page state"
    );
    expect(workerInstructions).toContain(
      "`browser_act` dispatches actions and returns the successor state"
    );
    expect(existsSync(`${workerRoot}/lib/browser-contract.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/lib/browser-runtime.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/lib/owned-browser.ts`)).toBe(true);

    expect(readFileSync(`${workerRoot}/lib/kernel.ts`, "utf8")).toContain(
      "new Kernel("
    );
    for (const tool of [
      "capture_browser_image",
      "computer_action",
      "manage_browsers",
    ]) {
      const source = readFileSync(`${executorBrowser}/${tool}.ts`, "utf8");
      expect(source).toContain(
        'from "@agent/subagents/browser-agent/lib/kernel"'
      );
      expect(source).not.toContain("new Kernel(");
    }
    expect(
      readFileSync(`${executorBrowser}/fill_from_vault.ts`, "utf8")
    ).toContain(
      'from "../../../agent/subagents/browser-agent/lib/autofill/native"'
    );
    expect(
      readFileSync(`${executorBrowser}/fill_from_vault.ts`, "utf8")
    ).toContain("releaseDelegatedSecret");
    expect(
      readFileSync(`${executorBrowser}/fill_from_vault.ts`, "utf8")
    ).not.toContain("readVaultSecret");
    expect(existsSync(`${executorBrowser}/get_password.ts`)).toBe(false);
    expect(existsSync(`${executorBrowser}/get_totp.ts`)).toBe(false);
    expect(existsSync(`${workerTools}/get_password.ts`)).toBe(false);
    expect(existsSync(`${workerTools}/get_totp.ts`)).toBe(false);
  });

  it("requires structured completion for initial and resumed worker calls", () => {
    const workerCoordination = readFileSync(
      "agent/instructions/content/worker-coordination.md",
      "utf8"
    );
    const workerConfig = readFileSync(`${workerRoot}/agent.ts`, "utf8");

    expect(workerCoordination).toContain(
      "Every initial or resumed `browser-agent` call must set `outputSchema`"
    );
    expect(workerCoordination).toContain(
      '"required": ["status", "message", "images"]'
    );
    expect(workerCoordination).toContain(
      "including when passing an existing `agentId`"
    );
    expect(workerCoordination).toContain(
      "calling Eve's native `final_output` tool exactly once"
    );
    expect(workerConfig).toContain("outputSchema: taskCompletionSchema");
    expect(workerConfig).toContain(
      "Every initial and resumed call must include the task-completion outputSchema"
    );
  });
});

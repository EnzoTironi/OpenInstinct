import { Effect, Result } from "effect";
import { expect, test } from "vitest";
import {
  publishWorkspaceGit,
  readWorkspaceGit,
  WorkspaceGitError,
} from "./git";

test("exports real Git history and restores prior file contents from a fresh bundle", async () => {
  const initial = await Effect.runPromise(
    publishWorkspaceGit({
      bundle: null,
      parent: null,
      path: "knowledge/plan.md",
      content: "# Original\n",
      message: "Create plan",
    })
  );
  expect(initial.bundle.subarray(0, 16).toString()).toContain("git bundle");
  const updated = await Effect.runPromise(
    publishWorkspaceGit({
      bundle: initial.bundle,
      parent: initial.revision,
      path: "knowledge/plan.md",
      content: "# Revised\n",
      message: "Revise plan",
    })
  );
  const previous = await Effect.runPromise(
    readWorkspaceGit(updated.bundle, initial.revision, "knowledge/plan.md")
  );
  const current = await Effect.runPromise(
    readWorkspaceGit(updated.bundle, updated.revision, "knowledge/plan.md")
  );
  expect(previous.content).toBe("# Original\n");
  expect(current.content).toBe("# Revised\n");
  const deleted = await Effect.runPromise(
    publishWorkspaceGit({
      bundle: updated.bundle,
      parent: updated.revision,
      path: "knowledge/plan.md",
      content: null,
      message: "Remove plan",
    })
  );
  expect(
    (
      await Effect.runPromise(
        readWorkspaceGit(deleted.bundle, deleted.revision)
      )
    ).files
  ).toEqual([]);
  expect(
    (
      await Effect.runPromise(
        readWorkspaceGit(deleted.bundle, initial.revision)
      )
    ).files
  ).toEqual(["knowledge/plan.md"]);
});

test.each([
  "../secret.md",
  "knowledge/../../secret.md",
  "agent/.git/hooks.md",
  "knowledge/a\nb.md",
  "knowledge/a..b.md",
  "skills/run.ts",
])("rejects unsafe or executable workspace paths: %s", async (path) => {
  const result = await Effect.runPromise(
    publishWorkspaceGit({
      bundle: null,
      parent: null,
      path,
      content: "content",
      message: "Invalid",
    }).pipe(Effect.result)
  );
  expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
    WorkspaceGitError
  );
});

test("enforces byte limits and rejects corrupt bundles instead of returning missing files", async () => {
  const oversized = await Effect.runPromise(
    publishWorkspaceGit({
      bundle: null,
      parent: null,
      path: "knowledge/large.md",
      content: "🌳".repeat(100_000),
      message: "Too large",
    }).pipe(Effect.result)
  );
  expect(Result.isFailure(oversized) && oversized.failure).toMatchObject({
    reason: "too_large",
  });
  const corrupt = await Effect.runPromise(
    readWorkspaceGit(Buffer.from("invalid"), "a".repeat(40)).pipe(Effect.result)
  );
  expect(Result.isFailure(corrupt) && corrupt.failure).toMatchObject({
    reason: "unavailable",
  });
});

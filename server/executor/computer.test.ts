import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  ComputerRejected,
  computerScopeKey,
  type ComputerScope,
} from "../operon-kernel";
import { HostComputer } from "./computer";

const alice: ComputerScope = {
  kind: "private",
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ComputerScope = {
  kind: "private",
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

const team: ComputerScope = {
  kind: "shared",
  audienceId: "group:telegram:acme",
  workspaceId: "company:acme",
};

describe("executor host computer", () => {
  it("does persist working files across process replacement in the same scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "zoen-computer-"));
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const first = new HostComputer(root);
          yield* first.open(alice, { privateMaterial: true });
          yield* first.write(alice, "notes/ana.txt", "acordo com Ana");
          yield* first.stop(alice);
          const replaced = new HostComputer(root);
          yield* replaced.open(alice, {});
          expect((yield* replaced.read(alice, "notes/ana.txt")).content).toBe(
            "acordo com Ana"
          );
          const leaked = yield* replaced
            .read(bob, "notes/ana.txt")
            .pipe(Effect.flip);
          expect(leaked).toBeInstanceOf(ComputerRejected);
          const shared = yield* replaced.reuse(alice, team).pipe(Effect.result);
          expect(Result.isFailure(shared)).toBe(true);
          if (
            Result.isFailure(shared) &&
            shared.failure instanceof ComputerRejected
          ) {
            expect(shared.failure.reason).toBe("private_material");
          }
          expect(
            replaced.environment({
              DATABASE_URL:
                "postgresql://postgres@127.0.0.1/open_instinct_prod",
              PATH: "/usr/bin",
            })
          ).toEqual({ PATH: "/usr/bin" });
          yield* replaced.dispose(alice);
          const gone = new HostComputer(root);
          const missing = yield* gone.open(alice, {}).pipe(
            Effect.andThen(() => gone.read(alice, "notes/ana.txt")),
            Effect.flip
          );
          expect(missing).toBeInstanceOf(ComputerRejected);
        })
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does keep one public computer path and no host_bash privilege", () => {
    expect(readFileSync("agent/tools/bash.ts", "utf8")).toContain(
      "disableTool()"
    );
    expect(readFileSync("agent/sandbox.ts", "utf8")).toContain(
      "justbash({ autoInstall: false })"
    );
    expect(readFileSync("agent/lib/child-role.ts", "utf8")).not.toContain(
      "host_bash"
    );
    expect(readFileSync("package.json", "utf8")).not.toContain(
      "@rivet-dev/agentos"
    );
    expect(computerScopeKey(alice)).not.toBe(computerScopeKey(bob));
    expect(computerScopeKey(alice)).not.toBe(computerScopeKey(team));
  });
});

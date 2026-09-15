import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ComputerRejected,
  InMemoryComputer,
  computerScopeKey,
  embeddedRuntimeDecision,
  guestEnvironment,
} from "./computer";
import type { ComputerScope } from "./computer";

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

describe("host-scoped computer", () => {
  it("does keep private, coworker and shared keys distinct in one workspace", () => {
    expect(computerScopeKey(alice)).not.toBe(computerScopeKey(bob));
    expect(computerScopeKey(alice)).not.toBe(computerScopeKey(team));
    expect(computerScopeKey(alice)).toContain("private");
    expect(computerScopeKey(team)).toContain("shared");
    expect(computerScopeKey(alice).includes("\0")).toBe(true);
  });

  it("does isolate files, restore after stop, and forget after dispose", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const computer = new InMemoryComputer();
        const opened = yield* computer.open(alice, { privateMaterial: true });
        expect(opened.reused).toBe(false);
        yield* computer.write(alice, "notes/ana.txt", "acordo com Ana");
        expect((yield* computer.read(alice, "notes/ana.txt")).content).toBe(
          "acordo com Ana"
        );
        yield* computer.open(bob, {});
        const coworker = yield* computer
          .read(bob, "notes/ana.txt")
          .pipe(Effect.flip);
        expect(coworker).toBeInstanceOf(ComputerRejected);
        if (coworker instanceof ComputerRejected) {
          expect(coworker.reason).toBe("invalid_parameter");
        }
        yield* computer.stop(alice);
        const restored = yield* computer.reopen(alice);
        expect(restored.paths).toEqual(["notes/ana.txt"]);
        yield* computer.dispose(alice);
        const gone = yield* computer.reopen(alice).pipe(Effect.flip);
        expect(gone).toBeInstanceOf(ComputerRejected);
        if (gone instanceof ComputerRejected) {
          expect(gone.reason).toBe("disposed");
        }
      })
    ));

  it("does refuse reusing a private run for a shared audience", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const computer = new InMemoryComputer();
        yield* computer.open(alice, { privateMaterial: true });
        const same = yield* computer.reuse(alice, alice);
        expect(same.key).toBe(computerScopeKey(alice));
        const shared = yield* computer.reuse(alice, team).pipe(Effect.result);
        expect(Result.isFailure(shared)).toBe(true);
        if (Result.isFailure(shared)) {
          expect(shared.failure).toBeInstanceOf(ComputerRejected);
          if (shared.failure instanceof ComputerRejected) {
            expect(shared.failure.reason).toBe("private_material");
          }
        }
        const coworker = yield* computer.reuse(alice, bob).pipe(Effect.flip);
        expect(coworker).toBeInstanceOf(ComputerRejected);
        if (coworker instanceof ComputerRejected) {
          expect(coworker.reason).toBe("scope_mismatch");
        }
        const forged = yield* computer
          .open(alice, { privateMaterial: true, userId: bob.userId })
          .pipe(Effect.flip);
        expect(forged).toBeInstanceOf(ComputerRejected);
        if (forged instanceof ComputerRejected) {
          expect(forged.reason).toBe("invalid_parameter");
        }
      })
    ));

  it("does keep host secrets out of the guest environment", () => {
    const guest = guestEnvironment({
      DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1/open_instinct_prod",
      BETTER_AUTH_SECRET: "openinstinct-local-auth-development-secret",
      SECRET_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      KERNEL_API_KEY: "kernel-secret",
      PATH: "/usr/bin",
      HOME: "/workspace",
      EXTRA: "should-not-copy",
    });
    expect(guest).toEqual({ HOME: "/workspace", PATH: "/usr/bin" });
    expect(embeddedRuntimeDecision.selected).toBe("eve-just-bash");
    expect(embeddedRuntimeDecision.agentOs).toBe("no-go");
    expect(embeddedRuntimeDecision.secondAgentLoop).toBe(false);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import { Config, ConfigProvider, Effect, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { confirmEmail, searchEmail, syncEmail } from "./email-flow";
import {
  APPROVER_SESSION_TOKEN_ENV,
  OperonMcpClient,
  buildOperonMcpSpawn,
  operonClientLayer,
} from "./mcp-client";

const scopeA = accessScopeForUser("better-auth:pilot-a");
const scopeB = accessScopeForUser("better-auth:pilot-b");
const directories: string[] = [];
const operonHome = Effect.runSync(Config.option(Config.string("OPERON_HOME")));
const sessionToken = "companion-session-token";
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

it("does pass the Companion session token as ApproverBinding and does not spawn operon approver session", () => {
  const spawn = buildOperonMcpSpawn({
    home: "/opt/operon",
    databaseUrl: "postgresql://cell/operon",
    sessionToken,
    authSecret: "test-auth-secret-0123456789abcdefghijklmnop",
    role: "consumer",
    workspaceId: scopeA.workspaceId,
  });
  expect(spawn.command).toBe(process.execPath);
  expect(spawn.args).toEqual([
    "/opt/operon/packages/cli/dist/bin.js",
    "mcp",
    "start",
    "--agent-tier",
    "2",
    "--role",
    "consumer",
    "--workspace",
    scopeA.workspaceId,
  ]);
  expect(spawn.args).not.toContain("approver");
  expect(spawn.args).not.toContain("session");
  expect(spawn.args).not.toContain("--host-approver");
  expect(spawn.args.join(" ")).not.toContain("approver session");
  expect(spawn.env[APPROVER_SESSION_TOKEN_ENV]).toBe(sessionToken);
  expect(spawn.env.OPERON_DATABASE_URL).toBe("postgresql://cell/operon");
  expect(spawn.env.OPERON_AUTH_SECRET).toBe(
    "test-auth-secret-0123456789abcdefghijklmnop"
  );
});

it("does refuse builder MCP without an explicit human confirm", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* OperonMcpClient;
      return yield* client
        .call("operon_review_mapping_proposal", { proposalId: "p1" })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(
        operonClientLayer({
          scope: scopeA,
          role: "builder",
          sessionToken,
        })
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          OPERON_HOME: "/opt/operon",
          OPERON_DATABASE_URL: "postgresql://cell/operon",
          OPERON_BUILDER_ENABLED: "true",
        })
      )
    )
  );
  expect(error.error).toBe("OperonUnavailable");
});

it("fails explicitly when the Operon connection is unconfigured", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* OperonMcpClient;
      return yield* client
        .call("operon_derive_identity_keys", { email: "ana@example.test" })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(
        operonClientLayer({
          scope: scopeA,
          role: "consumer",
          sessionToken,
        })
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({})
      )
    )
  );
  expect(error.error).toBe("OperonUnavailable");
});

describe.skipIf(Option.isNone(operonHome))(
  "real Operon workspace boundary",
  () => {
    it("survives restarts, isolates users and admits only the exact host-approved proposal", async () => {
      const directory = await mkdtemp(join(tmpdir(), "zoen-workspaces-"));
      directories.push(directory);
      const config = ConfigProvider.fromUnknown({
        OPERON_HOME: Option.getOrUndefined(operonHome),
        OPERON_DATABASE_URL: join(directory, "workspaces.db"),
        OPERON_BUILDER_ENABLED: "true",
        OPERON_AUTH_SECRET: "test-auth-secret-0123456789abcdefghijklmnop",
      });
      function run<A, E>(
        effect: Effect.Effect<A, E, OperonMcpClient>,
        scope: AccessScope,
        role: "consumer" | "builder",
        confirm?: boolean
      ) {
        return Effect.runPromise(
          effect.pipe(
            Effect.provide(
              operonClientLayer({
                scope,
                role,
                sessionToken,
                confirm,
              })
            ),
            Effect.provideService(ConfigProvider.ConfigProvider, config)
          )
        );
      }
      const snapshot = {
        ownerEmail: "pilot@example.test",
        messages: [1, 2].map((id) => ({
          from: { displayName: "Ana", email: "ana@example.test" },
          to: [{ displayName: "Pilot", email: "pilot@example.test" }],
          cc: [],
          messageId: `message-${String(id)}`,
          threadId: "thread-one",
          dateMs: Date.now(),
        })),
      };
      const proposal = await run(
        syncEmail(snapshot),
        scopeA,
        "builder",
        true
      );
      expect(proposal.card).toContain("1 pessoas");
      const replay = await run(syncEmail(snapshot), scopeA, "builder", true);
      expect(replay.proposalId).toBe(proposal.proposalId);
      expect(
        await run(searchEmail("Ana"), scopeA, "consumer")
      ).not.toHaveLength(0);
      expect(await run(searchEmail("Ana"), scopeB, "consumer")).toHaveLength(
        0
      );
      const pending = {
        workspaceId: scopeA.workspaceId,
        sessionId: "verified-session",
        proposalId: proposal.proposalId,
        digest: proposal.digest,
      };
      const refused = await run(
        confirmEmail(pending, proposal.digest).pipe(Effect.flip),
        scopeA,
        "builder"
      );
      expect(refused).toMatchObject({
        _tag: "OperonMcpError",
        error: "OperonUnavailable",
      });
      const denied = await run(
        Effect.gen(function* () {
          const client = yield* OperonMcpClient;
          return yield* client.call("operon_ingest_source", {
            payload: [],
            mediaType: "application/json",
            locator: "test://forged",
          });
        }),
        scopeA,
        "consumer"
      );
      expect(denied.isError).toBe(true);
    }, 30_000);
  }
);

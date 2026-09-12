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
  OperonMcpClient,
  operonClientLayer,
  type OperonApprovalRequest,
} from "./mcp-client";

const scopeA = accessScopeForUser("better-auth:pilot-a");
const scopeB = accessScopeForUser("better-auth:pilot-b");
const directories: string[] = [];
const operonHome = Effect.runSync(Config.option(Config.string("OPERON_HOME")));
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

it("fails explicitly when the Operon connection is unconfigured", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* OperonMcpClient;
      return yield* client
        .call("operon_derive_identity_keys", { email: "ana@example.test" })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(operonClientLayer({ scope: scopeA, role: "consumer" })),
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
      });
      function run<A, E>(
        effect: Effect.Effect<A, E, OperonMcpClient>,
        scope: AccessScope,
        role: "consumer" | "builder",
        approve?: (
          request: OperonApprovalRequest
        ) => Promise<Record<string, string | number | string[]>>
      ) {
        return Effect.runPromise(
          effect.pipe(
            Effect.provide(
              approve
                ? operonClientLayer({ scope, role, approve })
                : operonClientLayer({ scope, role })
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
      const proposal = await run(syncEmail(snapshot), scopeA, "builder");
      expect(proposal.card).toContain("1 pessoas");
      const replay = await run(syncEmail(snapshot), scopeA, "builder");
      expect(replay.proposalId).toBe(proposal.proposalId);
      expect(
        await run(searchEmail("Ana"), scopeA, "consumer")
      ).not.toHaveLength(0);
      expect(await run(searchEmail("Ana"), scopeB, "consumer")).toHaveLength(0);
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
        _tag: "EmailFlowError",
        reason: "unavailable",
      });
      let approvals = 0;
      const approve = async (request: OperonApprovalRequest) => {
        expect(request.tool).toBe("operon_review_mapping_proposal");
        expect(request.arguments).toMatchObject({
          proposalId: proposal.proposalId,
          viewedDigest: proposal.digest,
          verdict: "approve",
        });
        approvals += 1;
        return {
          userId: scopeA.userId,
          name: "Pilot",
          email: "pilot@example.test",
          roles: ["owner"],
          sessionId: "verified-session",
          issuer: "zoen",
          sessionExpiresAt: Date.now() + 30_000,
        };
      };
      expect(
        await run(
          confirmEmail(pending, proposal.digest),
          scopeA,
          "builder",
          approve
        )
      ).toMatchObject({ status: "merged", digest: proposal.digest });
      expect(approvals).toBe(1);
      expect(await run(searchEmail("Ana"), scopeA, "consumer")).toEqual([
        expect.objectContaining({
          email: "ana@example.test",
          grade: "batch",
          label: "registrado",
        }),
      ]);
      const registered = await run(
        Effect.gen(function* () {
          const client = yield* OperonMcpClient;
          return yield* client.call("operon_query_objects", {
            typeId: "Pessoa",
          });
        }),
        scopeA,
        "consumer"
      );
      expect(registered.body).toMatchObject({
        count: 1,
        objects: [
          {
            id: "ana@example.test",
            version: 1,
            properties: { displayName: "Ana" },
          },
        ],
      });
      expect(
        await run(
          confirmEmail(pending, proposal.digest),
          scopeA,
          "builder",
          approve
        )
      ).toMatchObject({ status: "merged" });
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

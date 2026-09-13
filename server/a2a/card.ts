import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { applicationOrigin } from "@shared/environment/origin";
import { authenticateAgentGrant } from "../workspaces/bots";
import { WorkspaceAccessDenied } from "../workspaces/access";

export const readAgentCard = Effect.fn("readAgentCard")(function* (
  username: string,
  authorization: string | null
) {
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT name, description, discoverable FROM workspace_bots WHERE username = ${username}`;
  if (!rows[0]) return yield* new WorkspaceAccessDenied();
  const bot = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      name: Schema.String,
      description: Schema.String,
      discoverable: Schema.Boolean,
    })
  )(rows[0]);
  if (!bot.discoverable) yield* authenticateAgentGrant(authorization, username);
  return {
    name: bot.name,
    description: bot.description || "Zoen workspace knowledge assistant",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: `${applicationOrigin()}/agents/${username}`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    securitySchemes: {
      bearer: { httpAuthSecurityScheme: { scheme: "bearer" } },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    skills: [
      {
        id: "workspace-knowledge",
        name: "Workspace knowledge",
        description:
          "Consult explicitly shared documents and structured knowledge within an expiring, revocable grant.",
        tags: ["knowledge", "workspace"],
      },
    ],
  };
});

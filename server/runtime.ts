import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { Config, Layer, ManagedRuntime } from "effect";
import { ChannelAccounts } from "./accounts";
import { NativeDeviceAuth } from "./accounts/device";
import { Artifacts } from "./artifacts";
import { Messaging } from "./messaging";
import { Telegram } from "./channels/telegram";
import { Kapso } from "./channels/kapso";
import { ChannelTransport } from "./channels/transport";
import { ChannelAuthPrompts } from "./channel-auth/prompts";
import { MemoryDocuments } from "./memory/documents";
import { PrincipalIssuer } from "./operon/principal";
import { EmailQcl } from "./operon/qcl";
import { SourceConnection } from "./operon/source-connection";
import { OperonBuilderStdio, OperonMcpClientStdio } from "./operon/mcp-client";
import { PersonalMemory } from "./personal-memory";
import { BrowserWorkerAccess } from "./browser-worker";

const database = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(10),
});

const infrastructure = Layer.mergeAll(
  ChannelAccounts.layer,
  BrowserWorkerAccess.layer,
  Messaging.layer,
  MemoryDocuments.layer,
  PersonalMemory.layer,
  Telegram.layer,
  Kapso.layer,
  ResolvedInstallationSecrets.layer
).pipe(Layer.provideMerge(database));

const operon = EmailQcl.layer.pipe(
  Layer.provideMerge(SourceConnection.layer),
  Layer.provideMerge(PrincipalIssuer.parseableLayer),
  Layer.provideMerge(OperonMcpClientStdio),
  Layer.provideMerge(OperonBuilderStdio)
);

const services = Layer.mergeAll(
  NativeDeviceAuth.layer,
  Artifacts.layer,
  ChannelTransport.layer,
  ChannelAuthPrompts.layer,
  operon
).pipe(Layer.provideMerge(infrastructure));

export const serverRuntime = ManagedRuntime.make(services);

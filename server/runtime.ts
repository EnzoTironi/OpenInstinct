import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { Config, Layer, ManagedRuntime } from "effect";

import { ChannelAccounts } from "./accounts";
import { NativeDeviceAuth } from "./accounts/device";
import { Artifacts } from "./artifacts";
import { BrowserWorkerAccess } from "./browser-worker";
import { ChannelAuthPrompts } from "./channel-auth/prompts";
import { Kapso } from "./channels/kapso";
import { Telegram } from "./channels/telegram";
import { ChannelTransport } from "./channels/transport";
import { MemoryDocuments } from "./memory/documents";
import { Messaging } from "./messaging";
import { PersonalMemory } from "./personal-memory";

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

const services = Layer.mergeAll(
  NativeDeviceAuth.layer,
  Artifacts.layer,
  ChannelTransport.layer,
  ChannelAuthPrompts.layer
).pipe(Layer.provideMerge(infrastructure));

export const serverRuntime = ManagedRuntime.make(services);

import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { WorkspaceRepository } from "./workspaces/repository";
import { LearnedMemory } from "./memory/learned";
import { Mem0 } from "./memory/mem0";
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
import { PersonalMemory } from "./personal-memory";
import { BrowserWorkerAccess } from "./browser-worker";
import { ErasureJournal } from "./accounts/erasure-journal";

const database = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(10),
});

const infrastructure = Layer.mergeAll(
  ErasureJournal.layer,
  ChannelAccounts.layer,
  BrowserWorkerAccess.layer,
  Messaging.layer,
  MemoryDocuments.layer,
  WorkspaceRepository.layer,
  LearnedMemory.layer.pipe(
    Layer.provide(Mem0.layer),
    Layer.provide(WorkspaceRepository.layer)
  ),
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

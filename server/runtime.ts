import { PgClient } from "@effect/sql-pg";
import { Config, Layer, ManagedRuntime } from "effect";
import { ChannelAccounts } from "./accounts";
import { Messaging } from "./messaging";
import { Telegram } from "./channels/telegram";
import { Kapso } from "./channels/kapso";
import { ChannelTransport } from "./channels/transport";
import { ChannelAuthPrompts } from "./channel-auth/prompts";
import { MemoryDocuments } from "./memory/documents";

const database = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(10),
});

const infrastructure = Layer.mergeAll(
  ChannelAccounts.layer,
  Messaging.layer,
  MemoryDocuments.layer,
  Telegram.layer,
  Kapso.layer
).pipe(Layer.provideMerge(database));

const services = Layer.mergeAll(
  ChannelTransport.layer,
  ChannelAuthPrompts.layer
).pipe(Layer.provideMerge(infrastructure));

export const serverRuntime = ManagedRuntime.make(services);

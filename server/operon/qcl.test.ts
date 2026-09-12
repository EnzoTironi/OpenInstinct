import { Effect, Layer, Predicate } from "effect";
import { expect, it } from "vitest";

import {
  builderOffCopy,
  connectCopy,
  gmailGatewaySeamCopy,
  imapSeamCopy,
  offerCopy,
  progressCopy,
} from "./copy";
import { OperonBuilder, OperonMcpClient, unavailableClient } from "./mcp-client";
import { EmailQcl } from "./qcl";
import { SourceConnection } from "./source-connection";

const testLayer = EmailQcl.layer.pipe(
  Layer.provide(SourceConnection.layer),
  Layer.provide(Layer.succeed(OperonMcpClient, unavailableClient)),
  Layer.provide(Layer.succeed(OperonBuilder, unavailableClient))
);

function datedMbox() {
  const date = new Date().toUTCString();
  return `From MAILER-DAEMON ${date}
From: Ana Silva <Ana.Silva@Unimed.com.br>
To: Enzo Tironi <enzo@unimed.com.br>
Date: ${date}
Message-ID: <ana@unimed.com.br>
Subject: Consulta

Olá Enzo, segue o retorno da consulta.

From MAILER-DAEMON ${date}
From: Bruno Lima <bruno@gmail.com>
To: Enzo Tironi <enzo@unimed.com.br>
Date: ${date}
Message-ID: <bruno@gmail.com>
Subject: Almoço

Vamos almoçar amanhã?

From MAILER-DAEMON ${date}
From: Carla Souza <carla@unimed.com.br>
To: Enzo Tironi <enzo@unimed.com.br>
Date: ${date}
Message-ID: <carla@unimed.com.br>
Subject: Escala

A escala da semana já fechou.
`;
}

function upload(format: "mbox" | "eml", text: string) {
  return {
    _tag: "MailboxUpload" as const,
    bytes: new TextEncoder().encode(text),
    format,
  };
}

it("does run Q→C on a Portuguese mailbox without admitting objects", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const qcl = yield* EmailQcl;
      return yield* qcl.run(upload("mbox", datedMbox()));
    }).pipe(Effect.provide(testLayer))
  );
  expect(Predicate.isTagged(result, "QclReady")).toBe(true);
  if (!Predicate.isTagged(result, "QclReady")) return;
  expect(progressCopy).toBe("Entrando conversas…");
  expect(result.card.copy).toBe(
    "3 conversas em quarentena, 3 pessoas, 1 empresas, 0 nomes em conflito."
  );
  expect(result.card.connectCopy).toBe(connectCopy);
  expect(result.classify.offerCopy).toBe(offerCopy);
  expect(result.classify.consumer).toBe("unlinked");
  expect(result.classify.people.map((person) => person.displayName)).toEqual([
    "Ana Silva",
    "Bruno Lima",
    "Carla Souza",
  ]);
  const bruno = result.classify.people.find(
    (person) => person.email === "bruno@gmail.com"
  );
  expect(bruno?.type).toBe("Pessoa");
  expect(bruno?.origin).toBe("chegou do e-mail");
  expect(bruno?.organization).toEqual({
    domain: "gmail.com",
    status: "suppressed",
    type: "não admitido",
  });
  expect(JSON.stringify(bruno)).not.toContain("Organização");
  const ana = result.classify.people.find(
    (person) => person.email === "ana.silva@unimed.com.br"
  );
  expect(ana?.organization).toEqual({
    confidence: 0.95,
    key: { kind: "domain", value: "unimed.com.br" },
    status: "derived",
    type: "Organização",
  });
});

it("does keep Gateway Gmail a named seam only", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const qcl = yield* EmailQcl;
      return yield* qcl.run({
        _tag: "GatewayGmail",
        accountId: "enzo-gmail",
        adapter: "gmail-gateway",
      });
    }).pipe(Effect.provide(testLayer))
  );
  expect(result).toEqual({
    _tag: "QclBlocked",
    copy: gmailGatewaySeamCopy,
    reason: "gmail_gateway_not_wired",
  });
});

it("does keep local IMAP unwired", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const qcl = yield* EmailQcl;
      return yield* qcl.run({
        _tag: "LocalImap",
        host: "127.0.0.1",
        mailbox: "INBOX",
        port: 993,
        user: "enzo",
      });
    }).pipe(Effect.provide(testLayer))
  );
  expect(result).toEqual({
    _tag: "QclBlocked",
    copy: imapSeamCopy,
    reason: "imap_not_wired",
  });
});

it("does keep Liberar off while Builder is unavailable", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const qcl = yield* EmailQcl;
      return yield* qcl.liberate("proposta-1");
    }).pipe(Effect.provide(testLayer))
  );
  expect(result).toEqual({
    _tag: "LiberateOff",
    copy: builderOffCopy,
  });
});

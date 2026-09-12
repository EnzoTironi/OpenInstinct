import { Effect } from "effect";
import { expect, it } from "vitest";

import { cardCopy, connectCopy } from "./copy";
import { cardCounts, parseMailbox } from "./mailbox";

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
Cc: Ana Silva <Ana.Silva@Unimed.com.br>
Date: ${date}
Message-ID: <carla@unimed.com.br>
Subject: Escala

A escala da semana já fechou.
`;
}

it("does parse a Portuguese mbox into people and threads", async () => {
  const snapshot = await Effect.runPromise(
    parseMailbox("mbox", datedMbox(), "enzo@unimed.com.br")
  );
  expect(snapshot.messages.map((message) => message.from.displayName)).toEqual([
    "Ana Silva",
    "Bruno Lima",
    "Carla Souza",
  ]);
  expect(snapshot.messages[0]?.from.email).toBe("ana.silva@unimed.com.br");
  const counts = cardCounts(snapshot.messages, snapshot.ownerEmail);
  expect(counts).toEqual({
    companies: 1,
    conflicts: 0,
    conversations: 3,
    people: 3,
  });
  expect(cardCopy(3, 3, 1, 0)).toBe(
    "3 conversas em quarentena, 3 pessoas, 1 empresas, 0 nomes em conflito."
  );
  expect(connectCopy).toBe(
    "Vou ler sua caixa para mostrar com quem você fala. Não vou mandar e-mail. Não vou alterar a agenda."
  );
});

it("does parse a Portuguese eml", async () => {
  const date = new Date().toUTCString();
  const snapshot = await Effect.runPromise(
    parseMailbox(
      "eml",
      `From: Ana Silva <Ana.Silva@Unimed.com.br>
To: Enzo Tironi <enzo@unimed.com.br>
Date: ${date}
Message-ID: <unico@unimed.com.br>
Subject: Único

Só este recado.
`
    )
  );
  expect(snapshot.messages).toHaveLength(1);
  expect(snapshot.messages[0]?.from.displayName).toBe("Ana Silva");
});

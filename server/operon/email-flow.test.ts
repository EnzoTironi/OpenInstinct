import { Effect, Layer } from "effect";
import { expect, it } from "vitest";

import {
  arrivedFromEmailLabel,
  connectCopy,
  notAdmittedLabel,
  offerCopy,
  typeBudget,
} from "./copy";
import { EmailFlow, EmailFlowError } from "./email-flow";
import { OperonMcpClient } from "./mcp-client";
import { memoryLayer } from "./mcp-memory";
import {
  AgentCall,
  encodeSessionToken,
  PrincipalIssuer,
  UserId,
} from "./principal";
import { LocalImap, MailboxUpload, SourceConnection } from "./source-connection";

const dateHeader = new Date(Date.now() - 86_400_000).toUTCString();

const phase1Mbox = `From ana.silva@unimed.com.br Fri Sep 10 12:00:00 2026
From: Ana Silva <ana.silva@unimed.com.br>
To: Clinica <clinica@example.com>
Date: ${dateHeader}
Message-ID: <ana-1@test.invalid>
Subject: Horario

ok

From bruno@gmail.com Fri Sep 10 12:05:00 2026
From: Bruno <bruno@gmail.com>
To: clinica@example.com
Date: ${dateHeader}
Message-ID: <bruno-1@test.invalid>
Subject: Ola

ok

From carla@unimed.com.br Fri Sep 10 12:10:00 2026
From: Carla <carla@unimed.com.br>
To: clinica@example.com
Date: ${dateHeader}
Message-ID: <carla-1@test.invalid>
Subject: Exames

ok

From ana.outra@hospital.com.br Fri Sep 10 12:15:00 2026
From: Ana Silva <ana.outra@hospital.com.br>
To: clinica@example.com
Date: ${dateHeader}
Message-ID: <ana-2@test.invalid>
Subject: Encaminhamento

ok
`;

const expectedCard =
  "4 conversas em quarentena, 4 pessoas, 2 empresas, 1 nomes em conflito.";

const testLayer = Layer.mergeAll(
  EmailFlow.layer,
  SourceConnection.layer,
  PrincipalIssuer.parseableLayer
).pipe(Layer.provideMerge(memoryLayer));

const attachPhase1 = Effect.fn("attachPhase1")(function* () {
  const flow = yield* EmailFlow;
  yield* flow.attach(
    MailboxUpload.make({
      bytes: new Uint8Array(Buffer.from(phase1Mbox)),
      format: "mbox",
    })
  );
  return flow;
});

it("does keep the type budget to Pessoa, Organização, Conversa, Compromisso", () => {
  expect(typeBudget).toEqual([
    "Pessoa",
    "Organização",
    "Conversa",
    "Compromisso",
  ]);
});

it("does show the connect copy, card, offer, and labeled search before admit", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const flow = yield* attachPhase1();
      expect(yield* flow.connect()).toBe(
        "Vou ler sua caixa para mostrar com quem você fala. Não vou mandar e-mail. Não vou alterar a agenda."
      );
      expect(yield* flow.connect()).toBe(connectCopy);
      const synced = yield* flow.sync();
      expect(synced.card).toBe(expectedCard);
      expect(synced.offer).toBe(
        "Registrar as pessoas com quem você falou nos últimos 30 dias"
      );
      expect(synced.offer).toBe(offerCopy);
      expect(synced.progress).toContain("Entrando conversas…");
      expect(yield* flow.offer()).toBe(offerCopy);

      const hits = yield* flow.search("Ana Silva");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((hit) => hit.label === "não admitido")).toBe(true);
      expect(hits.every((hit) => hit.label === notAdmittedLabel)).toBe(true);
      expect(hits.every((hit) => hit.source === "chegou do e-mail")).toBe(true);
      expect(hits.every((hit) => hit.source === arrivedFromEmailLabel)).toBe(
        true
      );
      expect(JSON.stringify(hits)).not.toContain("Paciente");
      expect(JSON.stringify(hits)).not.toContain("ontologia");
      expect(synced.card).not.toContain("gmail.com");

      const consumer = yield* OperonMcpClient;
      const objects = yield* consumer.call("operon_query_objects", {
        typeId: "Pessoa",
      });
      expect(objects.body).toMatchObject({ count: 0 });

      const bruno = yield* consumer.call("operon_derive_identity_keys", {
        email: "bruno@gmail.com",
      });
      expect(bruno.body).toMatchObject({
        organization: { domain: "gmail.com", status: "suppressed" },
      });
    }).pipe(Effect.provide(testLayer))
  );
});

it("does refuse Consumer review and AgentCall confirmation", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const flow = yield* attachPhase1();
      const synced = yield* flow.sync();
      const consumer = yield* OperonMcpClient;
      const review = yield* consumer.call("operon_review_mapping_proposal", {
        proposalId: synced.proposalId,
        reviewerId: "owner-clinic",
        verdict: "approve",
        viewedDigest: synced.digest,
      });
      expect(review.isError).toBe(true);
      expect(review.body).toMatchObject({ error: "McpSecurityError" });

      const denied = yield* flow
        .confirm(
          AgentCall.make({
            agentId: "eve",
            grants: ["consumer"],
            sponsor: UserId.make("user-ana"),
          }),
          synced.digest
        )
        .pipe(Effect.flip);
      expect(denied).toEqual(
        new EmailFlowError({ reason: "agents_cannot_approve" })
      );
    }).pipe(Effect.provide(testLayer))
  );
});

it("does admit the digest only after a Principal confirms", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const flow = yield* attachPhase1();
      const synced = yield* flow.sync();
      const issuer = yield* PrincipalIssuer;
      const principal = yield* issuer.fromSessionToken(
        encodeSessionToken({
          audience: "companion",
          grants: ["consumer"],
          orgId: "companion-cell",
          sessionId: "sess-1",
          userId: "user-ana",
        })
      );
      const admitted = yield* flow.confirm(principal, synced.digest);
      expect(admitted).toEqual({ digest: synced.digest, status: "merged" });

      const consumer = yield* OperonMcpClient;
      const objects = yield* consumer.call("operon_query_objects", {
        typeId: "Pessoa",
      });
      expect(objects.body).toMatchObject({ count: 4 });
    }).pipe(Effect.provide(testLayer))
  );
});

it("does refuse a stale digest and leave IMAP unwired", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const flow = yield* attachPhase1();
      const synced = yield* flow.sync();
      const issuer = yield* PrincipalIssuer;
      const principal = yield* issuer.fromSessionToken(
        encodeSessionToken({
          audience: "companion",
          grants: ["consumer"],
          orgId: "companion-cell",
          sessionId: "sess-1",
          userId: "user-ana",
        })
      );
      const stale = yield* flow
        .confirm(principal, "0".repeat(64))
        .pipe(Effect.flip);
      expect(stale).toEqual(new EmailFlowError({ reason: "stale_digest" }));
      expect(synced.digest).not.toBe("0".repeat(64));

      const source = yield* SourceConnection;
      const imap = yield* source
        .read(
          LocalImap.make({
            host: "127.0.0.1",
            mailbox: "INBOX",
            port: 993,
            user: "clinic",
          })
        )
        .pipe(Effect.flip);
      expect(imap.reason).toBe("imap_not_wired");
    }).pipe(Effect.provide(testLayer))
  );
});

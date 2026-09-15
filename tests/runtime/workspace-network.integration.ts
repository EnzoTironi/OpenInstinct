import { randomUUID } from "node:crypto";
import { Effect, Layer, Result, Schema } from "effect";
import { expect, test } from "vitest";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import {
  A2AError,
  A2AMessageSchema,
  cancelProtocolTask,
  finishProtocolTask,
  readProtocolTask,
} from "../../server/a2a/tasks";
import { readExecutorCatalog } from "../../server/executor/workspace";
import {
  saveWorkspaceBot,
  searchWorkspaceBots,
} from "../../server/workspaces/bots";
import {
  ContactNetworkBotSchema,
  answerPersonalTrust,
  blockPersonalTrust,
  contactNetworkBot,
  endPersonalTrust,
  invitePersonalTrust,
  listPersonalNetwork,
} from "../../server/workspaces/network";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import {
  inviteWorkspaceMember,
  removeWorkspaceMember,
} from "../../server/workspaces/team";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
const handle = (prefix: string) =>
  `${prefix}${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const profile = (name: string) => ({
  username: handle("b"),
  name,
  description: "Synthetic network bot",
  discoverable: true,
});
const prompt = (text: string) => ({
  messageId: randomUUID(),
  role: "ROLE_USER" as const,
  parts: [{ text }],
});
const denied = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isFailure(result)).toBe(true);
};

test("company members discover and contact the published workspace bot without file grants", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, guestPersonal, repository } =
        yield* workspaceFixture();
      const secret = yield* repository.write(actor, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/secret.md",
        content: "canary-company-secret",
      });
      const bot = yield* saveWorkspaceBot(actor, profile("Company Zoen"));
      expect(yield* searchWorkspaceBots(guest, bot.username)).toHaveLength(1);
      expect(yield* searchWorkspaceBots(personal, bot.username)).toEqual([]);
      const contact = yield* contactNetworkBot(guest, {
        destUsername: bot.username,
        message: prompt("Hello company bot"),
      });
      expect(contact.network.kind).toBe("company");
      expect(contact.task.round).toBe(1);
      expect(
        (yield* readExecutorCatalog(contact.destActor)).tools.map(
          (tool) => tool.path
        )
      ).toEqual([]);
      denied(
        yield* repository
          .read(contact.destActor, "knowledge/secret.md", secret.revision)
          .pipe(Effect.result)
      );
      expect((yield* repository.read(contact.destActor)).files).not.toContain(
        "knowledge/secret.md"
      );
      const replay = yield* contactNetworkBot(guest, {
        destUsername: bot.username,
        message: {
          messageId: contact.task.messageId,
          role: "ROLE_USER",
          parts: [{ text: "Hello company bot" }],
        },
      });
      expect(replay.task.id).toBe(contact.task.id);
      const other = yield* contactNetworkBot(actor, {
        destUsername: bot.username,
        message: prompt("Second member"),
      });
      denied(
        yield* readProtocolTask(contact.destActor, other.task.id).pipe(
          Effect.result
        )
      );
      denied(
        yield* Schema.decodeUnknownEffect(A2AMessageSchema)(
          {
            message: prompt("Forged"),
            networkKind: "company",
          },
          { onExcessProperty: "error" }
        ).pipe(Effect.result)
      );
      denied(
        yield* Schema.decodeUnknownEffect(ContactNetworkBotSchema)(
          {
            destUsername: bot.username,
            message: prompt("Forged"),
            networkKind: "company",
          },
          { onExcessProperty: "error" }
        ).pipe(Effect.result)
      );
      yield* cancelProtocolTask(contact.destActor, contact.task.id);
      yield* finishProtocolTask(
        contact.destActor,
        contact.task.id,
        "TASK_STATE_COMPLETED",
        "Late answer"
      );
      expect(
        (yield* readProtocolTask(contact.destActor, contact.task.id)).state
      ).toBe("TASK_STATE_CANCELED");
      denied(
        yield* contactNetworkBot(guestPersonal, {
          destUsername: bot.username,
          message: prompt("Personal actor"),
        }).pipe(Effect.result)
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("pending invites are not trust, personal accept is required, and block ends the grant", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, personal, guestPersonal } = yield* workspaceFixture();
      const ana = handle("ana");
      const bruno = handle("bruno");
      yield* saveDirectoryProfile(personal, {
        username: ana,
        discoverable: true,
      });
      yield* saveDirectoryProfile(guestPersonal, {
        username: bruno,
        discoverable: true,
      });
      denied(
        yield* invitePersonalTrust(actor, { username: bruno }).pipe(
          Effect.result
        )
      );
      const invited = yield* invitePersonalTrust(personal, { username: bruno });
      expect(
        (yield* listPersonalNetwork(guestPersonal)).invites.map(
          (row) => row.direction
        )
      ).toEqual(["received"]);
      const brunoBot = yield* saveWorkspaceBot(
        guestPersonal,
        profile("Bruno Zoen")
      );
      expect(yield* searchWorkspaceBots(personal, brunoBot.username)).toEqual(
        []
      );
      denied(
        yield* contactNetworkBot(personal, {
          destUsername: brunoBot.username,
          message: prompt("Before accept"),
        }).pipe(Effect.result)
      );
      yield* answerPersonalTrust(guestPersonal, {
        id: invited.id,
        accept: true,
      });
      expect(
        (yield* listPersonalNetwork(personal)).connections.map(
          (row) => row.username
        )
      ).toEqual([bruno]);
      expect(
        yield* searchWorkspaceBots(personal, brunoBot.username)
      ).toHaveLength(1);
      const talk = yield* contactNetworkBot(personal, {
        destUsername: brunoBot.username,
        message: prompt("After accept"),
      });
      expect(talk.network.kind).toBe("personal");
      yield* blockPersonalTrust(guestPersonal, { username: ana });
      denied(
        yield* contactNetworkBot(personal, {
          destUsername: brunoBot.username,
          message: prompt("After block"),
        }).pipe(Effect.result)
      );
      denied(yield* readExecutorCatalog(talk.destActor).pipe(Effect.result));
      denied(
        yield* invitePersonalTrust(personal, { username: bruno }).pipe(
          Effect.result
        )
      );
      expect(yield* searchWorkspaceBots(personal, brunoBot.username)).toEqual(
        []
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("trust is not transitive and two company networks stay separate", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, guestPersonal, sql } =
        yield* workspaceFixture();
      const ana = handle("ana");
      const bruno = handle("bruno");
      const carlaName = handle("carla");
      yield* saveDirectoryProfile(personal, {
        username: ana,
        discoverable: true,
      });
      yield* saveDirectoryProfile(guestPersonal, {
        username: bruno,
        discoverable: true,
      });
      const carlaRaw = `carla-${randomUUID()}`;
      const carlaSession = randomUUID();
      const carlaScope = accessScopeForUser(`better-auth:${carlaRaw}`);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM workspaces WHERE id = ${carlaScope.workspaceId}`;
          yield* sql`DELETE FROM public.user WHERE id = ${carlaRaw}`;
        }).pipe(Effect.orDie)
      );
      yield* sql`INSERT INTO public.user (id, name, email) VALUES
        (${carlaRaw}, 'Carla', ${`${carlaRaw}@example.invalid`})`;
      yield* sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES
        (${carlaSession}, ${carlaSession}, ${carlaRaw}, now() + interval '1 hour', now())`;
      yield* sql`INSERT INTO workspaces (id, organization_id) VALUES (${carlaScope.workspaceId}, NULL)`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${carlaScope.workspaceId}, ${carlaScope.userId}, 'owner')`;
      const carla = {
        userId: carlaScope.userId,
        workspaceId: carlaScope.workspaceId,
        authSessionId: carlaSession,
      };
      yield* saveDirectoryProfile(carla, {
        username: carlaName,
        discoverable: true,
      });
      const first = yield* invitePersonalTrust(personal, { username: bruno });
      yield* answerPersonalTrust(guestPersonal, {
        id: first.id,
        accept: true,
      });
      const second = yield* invitePersonalTrust(guestPersonal, {
        username: carlaName,
      });
      yield* answerPersonalTrust(carla, { id: second.id, accept: true });
      const carlaBot = yield* saveWorkspaceBot(carla, profile("Carla Zoen"));
      expect(yield* searchWorkspaceBots(personal, carlaBot.username)).toEqual(
        []
      );
      denied(
        yield* contactNetworkBot(personal, {
          destUsername: carlaBot.username,
          message: prompt("Inherited trust"),
        }).pipe(Effect.result)
      );
      yield* endPersonalTrust(personal, { username: bruno });
      const orgB = `org-b-${randomUUID()}`;
      const teamB = `team-b-${randomUUID()}`;
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM workspaces WHERE id = ${teamB}`;
          yield* sql`DELETE FROM organizations WHERE id = ${orgB}`;
        }).pipe(Effect.orDie)
      );
      yield* sql`INSERT INTO organizations (id, name) VALUES (${orgB}, 'Second company')`;
      yield* sql`INSERT INTO workspaces (id, organization_id) VALUES (${teamB}, ${orgB})`;
      yield* sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES
        (${orgB}, ${guest.userId}, 'admin'), (${orgB}, ${actor.userId}, 'member')`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${teamB}, ${guest.userId}, 'admin'), (${teamB}, ${actor.userId}, 'member')`;
      const companyB = { ...guest, workspaceId: teamB };
      const botB = yield* saveWorkspaceBot(companyB, profile("Second Zoen"));
      expect(yield* searchWorkspaceBots(actor, botB.username)).toEqual([]);
      denied(
        yield* contactNetworkBot(actor, {
          destUsername: botB.username,
          message: prompt("Wrong company"),
        }).pipe(Effect.result)
      );
      expect(
        yield* searchWorkspaceBots(
          { ...actor, workspaceId: teamB },
          botB.username
        )
      ).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("removing a member revokes their network conversation and unpublished personal bots stay off the company network", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal } = yield* workspaceFixture();
      const companyBot = yield* saveWorkspaceBot(
        actor,
        profile("Company Zoen")
      );
      const personalBot = yield* saveWorkspaceBot(
        personal,
        profile("Personal Zoen")
      );
      expect(yield* searchWorkspaceBots(guest, personalBot.username)).toEqual(
        []
      );
      denied(
        yield* contactNetworkBot(guest, {
          destUsername: personalBot.username,
          message: prompt("Personal bot at work"),
        }).pipe(Effect.result)
      );
      const talk = yield* contactNetworkBot(guest, {
        destUsername: companyBot.username,
        message: prompt("Pending work"),
      });
      yield* removeWorkspaceMember(actor, guest.userId);
      denied(yield* readExecutorCatalog(talk.destActor).pipe(Effect.result));
      denied(
        yield* contactNetworkBot(guest, {
          destUsername: companyBot.username,
          message: prompt("After removal"),
        }).pipe(Effect.result)
      );
      denied(
        yield* searchWorkspaceBots(guest, companyBot.username).pipe(
          Effect.result
        )
      );
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("bot-to-bot chains stop at eight rounds and a pending company invite cannot use the network", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, personal, guestPersonal, sql } = yield* workspaceFixture();
      const outsiderRaw = `invitee-${randomUUID()}`;
      const outsiderSession = randomUUID();
      const outsiderScope = accessScopeForUser(`better-auth:${outsiderRaw}`);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM workspaces WHERE id = ${outsiderScope.workspaceId}`;
          yield* sql`DELETE FROM public.user WHERE id = ${outsiderRaw}`;
        }).pipe(Effect.orDie)
      );
      yield* sql`INSERT INTO public.user (id, name, email) VALUES
        (${outsiderRaw}, 'Invitee', ${`${outsiderRaw}@example.invalid`})`;
      yield* sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES
        (${outsiderSession}, ${outsiderSession}, ${outsiderRaw}, now() + interval '1 hour', now())`;
      yield* sql`INSERT INTO workspaces (id, organization_id) VALUES (${outsiderScope.workspaceId}, NULL)`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${outsiderScope.workspaceId}, ${outsiderScope.userId}, 'owner')`;
      const outsider = {
        userId: outsiderScope.userId,
        workspaceId: outsiderScope.workspaceId,
        authSessionId: outsiderSession,
      };
      const invitee = handle("inv");
      yield* saveDirectoryProfile(outsider, {
        username: invitee,
        discoverable: true,
      });
      yield* inviteWorkspaceMember(actor, invitee);
      const companyBot = yield* saveWorkspaceBot(
        actor,
        profile("Company Zoen")
      );
      denied(
        yield* searchWorkspaceBots(
          { ...outsider, workspaceId: actor.workspaceId },
          companyBot.username
        ).pipe(Effect.result)
      );
      const ana = handle("ana");
      const bruno = handle("bruno");
      yield* saveDirectoryProfile(personal, {
        username: ana,
        discoverable: true,
      });
      yield* saveDirectoryProfile(guestPersonal, {
        username: bruno,
        discoverable: true,
      });
      const invited = yield* invitePersonalTrust(personal, { username: bruno });
      yield* answerPersonalTrust(guestPersonal, {
        id: invited.id,
        accept: true,
      });
      const anaBot = yield* saveWorkspaceBot(personal, profile("Ana Zoen"));
      const brunoBot = yield* saveWorkspaceBot(
        guestPersonal,
        profile("Bruno Zoen")
      );
      let last = yield* contactNetworkBot(personal, {
        destUsername: brunoBot.username,
        message: prompt("Round 1"),
      });
      const first = last.task.correlationId;
      for (let round = 2; round <= 8; round++) {
        const from = round % 2 === 0 ? guestPersonal : personal;
        const destUsername =
          round % 2 === 0 ? anaBot.username : brunoBot.username;
        last = yield* contactNetworkBot(from, {
          destUsername,
          originTaskId: last.task.id,
          message: prompt(`Round ${String(round)}`),
        });
        expect(last.task.round).toBe(round);
        expect(last.task.correlationId).toBe(first);
      }
      const ninth = yield* contactNetworkBot(personal, {
        destUsername: brunoBot.username,
        originTaskId: last.task.id,
        message: prompt("Round 9"),
      }).pipe(Effect.result);
      expect(Result.isFailure(ninth) && ninth.failure).toBeInstanceOf(A2AError);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("review #116: organization membership allows contact without granting project files", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, sql, repository } = yield* workspaceFixture();
      const secondWorkspaceId = `review-project-${randomUUID()}`;
      const org = yield* sql<{
        organization_id: string;
      }>`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`;
      const organizationId = org[0]?.organization_id;
      if (!organizationId) throw new Error("Company fixture missing");
      yield* Effect.addFinalizer(() =>
        sql`DELETE FROM workspaces WHERE id = ${secondWorkspaceId}`.pipe(
          Effect.orDie
        )
      );
      yield* sql`INSERT INTO workspaces(id, organization_id) VALUES (${secondWorkspaceId}, ${organizationId})`;
      yield* sql`INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (${secondWorkspaceId}, ${actor.userId}, 'admin')`;
      const destination = { ...actor, workspaceId: secondWorkspaceId };
      const bot = yield* saveWorkspaceBot(destination, {
        username: `review${randomUUID().replaceAll("-", "").slice(0, 14)}`,
        name: "Published company bot",
        description: "Synthetic review",
        discoverable: true,
      });
      yield* repository.write(destination, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/private.md",
        content: "project-private-canary",
      });
      const listed = yield* searchWorkspaceBots(guest, bot.username);
      const contact = yield* contactNetworkBot(guest, {
        destUsername: bot.username,
        message: {
          messageId: randomUUID(),
          role: "ROLE_USER",
          parts: [{ text: "Hello colleague" }],
        },
      }).pipe(Effect.result);
      expect({
        discoverable: listed.length,
        contactAllowed: Result.isSuccess(contact),
      }).toEqual({ discoverable: 1, contactAllowed: true });
      if (Result.isSuccess(contact)) {
        const file = yield* repository
          .read(contact.success.destActor, "knowledge/private.md")
          .pipe(Effect.result);
        expect(Result.isFailure(file)).toBe(true);
      }
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

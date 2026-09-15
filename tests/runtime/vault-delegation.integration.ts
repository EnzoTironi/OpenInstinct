import { randomUUID } from "node:crypto";
import { Effect, Layer, Redacted, Result } from "effect";
import { expect, test } from "vitest";
import { ResolvedInstallationSecrets } from "../../db/services/installation-secrets";
import { listVaultItems, saveVaultItem } from "../../db/services/vault";
import { serializeLoginVaultPayload } from "../../shared/vault/schema";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { removeWorkspaceMember } from "../../server/workspaces/team";
import {
  delegateVaultItem,
  inspectVaultDelegations,
  listDelegatedVaultItems,
  releaseDelegatedSecret,
  requireVaultwarden,
  revokeVaultDelegation,
  VaultwardenUnavailable,
} from "../../server/workspaces/vault";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase),
  Layer.provideMerge(ResolvedInstallationSecrets.layer)
);
const denied = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isFailure(result)).toBe(true);
};
const login = (label: string, password: string) => ({
  kind: "login" as const,
  label,
  account: "",
  secret: serializeLoginVaultPayload({
    version: 2,
    kind: "login",
    origin: "https://login.example.invalid",
    identifier: { type: "email", value: `${label}@example.invalid` },
    authentication: { type: "password", password },
  }),
});

test("Vaultwarden stays unavailable without a live instance", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* requireVaultwarden().pipe(Effect.result);
      expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
        VaultwardenUnavailable
      );
      return true;
    }).pipe(Effect.provide(services))
  ));

test("the agent unwraps only the delegated item and does not read the user ciphertext", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, sql } = yield* workspaceFixture();
      const scope = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      };
      const delegatedPassword = `canary-delegated-${randomUUID()}`;
      const privatePassword = `canary-private-${randomUUID()}`;
      yield* Effect.tryPromise({
        try: () => saveVaultItem(scope, login("Delegated", delegatedPassword)),
        catch: () => new WorkspaceAccessDenied(),
      });
      yield* Effect.tryPromise({
        try: () => saveVaultItem(scope, login("Private", privatePassword)),
        catch: () => new WorkspaceAccessDenied(),
      });
      const saved = yield* Effect.tryPromise({
        try: () => listVaultItems(scope),
        catch: () => new WorkspaceAccessDenied(),
      });
      const delegated = saved.find((item) => item.label === "Delegated");
      const kept = saved.find((item) => item.label === "Private");
      if (!delegated || !kept) return yield* new WorkspaceAccessDenied();
      expect(yield* listDelegatedVaultItems(scope)).toEqual([]);
      denied(
        yield* delegateVaultItem(guest, {
          itemId: delegated.id,
          days: 7,
        }).pipe(Effect.result)
      );
      const grant = yield* delegateVaultItem(actor, {
        itemId: delegated.id,
        days: 7,
      });
      expect(
        yield* delegateVaultItem(actor, { itemId: delegated.id, days: 7 })
      ).toEqual(grant);
      const controls = yield* inspectVaultDelegations(actor);
      expect(controls.mayManage).toBe(true);
      expect(controls.items).toEqual([
        expect.objectContaining({ id: grant.id, itemId: delegated.id }),
      ]);
      expect((yield* inspectVaultDelegations(guest)).mayManage).toBe(false);
      const listed = yield* listDelegatedVaultItems(scope);
      expect(listed.map((item) => item.handle)).toEqual([delegated.id]);
      expect(JSON.stringify(listed)).not.toContain(delegatedPassword);
      expect(JSON.stringify(listed)).not.toContain(privatePassword);
      yield* sql`UPDATE encrypted_secrets SET encrypted_value = 'garbage'
        WHERE workspace_id = ${actor.workspaceId} AND id = ${delegated.id}`;
      const released = yield* releaseDelegatedSecret(scope, delegated.id);
      expect(Redacted.value(released)).toContain(delegatedPassword);
      denied(yield* releaseDelegatedSecret(scope, kept.id).pipe(Effect.result));
      denied(
        yield* releaseDelegatedSecret(
          { userId: actor.userId, workspaceId: personal.workspaceId },
          delegated.id
        ).pipe(Effect.result)
      );
      const guestFill = yield* releaseDelegatedSecret(
        { userId: guest.userId, workspaceId: actor.workspaceId },
        delegated.id
      );
      expect(Redacted.value(guestFill)).toContain(delegatedPassword);
      yield* revokeVaultDelegation(actor, grant.id);
      yield* revokeVaultDelegation(actor, grant.id);
      denied(
        yield* releaseDelegatedSecret(scope, delegated.id).pipe(Effect.result)
      );
      expect(yield* listDelegatedVaultItems(scope)).toEqual([]);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("company delegations stay off the personal workspace and expiry plus removal end fill", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, sql } = yield* workspaceFixture();
      const companyScope = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      };
      const password = `canary-company-${randomUUID()}`;
      yield* Effect.tryPromise({
        try: () => saveVaultItem(companyScope, login("Company", password)),
        catch: () => new WorkspaceAccessDenied(),
      });
      const saved = yield* Effect.tryPromise({
        try: () => listVaultItems(companyScope),
        catch: () => new WorkspaceAccessDenied(),
      });
      const item = saved[0];
      if (!item) return yield* new WorkspaceAccessDenied();
      const grant = yield* delegateVaultItem(actor, {
        itemId: item.id,
        days: 7,
      });
      expect(
        yield* listDelegatedVaultItems({
          userId: actor.userId,
          workspaceId: personal.workspaceId,
        })
      ).toEqual([]);
      denied(
        yield* releaseDelegatedSecret(
          { userId: actor.userId, workspaceId: personal.workspaceId },
          item.id
        ).pipe(Effect.result)
      );
      expect(
        Redacted.value(yield* releaseDelegatedSecret(companyScope, item.id))
      ).toContain(password);
      yield* sql`UPDATE vault_item_delegations SET expires_at = now() - interval '1 minute'
        WHERE id = ${grant.id}`;
      denied(
        yield* releaseDelegatedSecret(companyScope, item.id).pipe(Effect.result)
      );
      yield* delegateVaultItem(actor, { itemId: item.id, days: 7 });
      expect(
        Redacted.value(
          yield* releaseDelegatedSecret(
            { userId: guest.userId, workspaceId: actor.workspaceId },
            item.id
          )
        )
      ).toContain(password);
      yield* removeWorkspaceMember(actor, guest.userId);
      denied(
        yield* releaseDelegatedSecret(
          { userId: guest.userId, workspaceId: actor.workspaceId },
          item.id
        ).pipe(Effect.result)
      );
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

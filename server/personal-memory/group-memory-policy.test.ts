import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { bindGroupChannelIdentity } from "../channels/group-policy";
import { PersonalMemoryError } from "./access";
import {
  admitPersonalMemoryAccess,
  admitPersonalMemoryFromSession,
  admitPersonalWipeTarget,
  admitSharedGroupMemoryRead,
  classifySessionMemoryKind,
  groupSessionMemoryAttributes,
  parseConversationMemoryScope,
  personalWipeCoverage,
  readSharedGroupMemoryStub,
  sharedGroupMemoryModel,
} from "./group-memory-policy";

const groupScope = "group:telegram:123456:-100123";

const otherGroupScope = "group:telegram:123456:-100999";

describe("G02 shared vs personal memory boundary", () => {
  it("documents the shared-group memory stub model", () => {
    expect(sharedGroupMemoryModel.storage).toBe("stub");
    expect(sharedGroupMemoryModel.rules.personalRecallFromGroupSession).toBe(
      "deny"
    );
    expect(sharedGroupMemoryModel.rules.personalWipeAffectsSharedGroup).toBe(
      false
    );
    expect(sharedGroupMemoryModel.rules.crossGroupRead).toBe("deny");
    expect(personalWipeCoverage.neverWiped).toContain("shared-group-memory");
  });

  it("parses G01 conversationScope from bindGroupChannelIdentity", async () => {
    const binding = await Effect.runPromise(
      bindGroupChannelIdentity({
        identityId: "11111111-1111-4111-8111-111111111111",
        channel: "telegram",
        installationId: "123456",
        senderId: "789012",
        chatId: "-100123",
      })
    );

    expect(binding.conversationScope).toBe(groupScope);
    const parsed = parseConversationMemoryScope(binding.conversationScope);
    expect(parsed).toEqual({
      kind: "shared-group",
      conversationScope: groupScope,
      channel: "telegram",
      installationId: "123456",
      chatId: "-100123",
    });
    const attrs = groupSessionMemoryAttributes(binding);
    expect(attrs).toEqual({
      conversationScope: groupScope,
      chatKind: "group",
      groupChatId: "-100123",
    });
    expect(classifySessionMemoryKind(attrs)).toBe("shared-group");
  });

  it("denies personal memory access for group-scoped sessions (no cross-read)", async () => {
    const error = await Effect.runPromise(
      admitPersonalMemoryAccess({
        conversationScope: groupScope,
        chatKind: "group",
      }).pipe(Effect.flip)
    );

    expect(error).toEqual(new PersonalMemoryError({ reason: "cross_scope" }));

    const fromSession = await Effect.runPromise(
      admitPersonalMemoryFromSession({
        principalId: "better-auth:user-1",
        principalType: "user",
        authenticator: "verified-channel",
        attributes: {
          conversationScope: groupScope,
          chatKind: "group",
          workspaceId: "ws-1",
        },
      }).pipe(Effect.flip)
    );

    expect(fromSession).toEqual(
      new PersonalMemoryError({ reason: "cross_scope" })
    );
  });

  it("denies personal wipe when the target is a group conversationScope", async () => {
    const error = await Effect.runPromise(
      admitPersonalWipeTarget({
        conversationScope: groupScope,
        chatKind: "group",
      }).pipe(Effect.flip)
    );

    expect(error).toEqual(new PersonalMemoryError({ reason: "cross_scope" }));
  });

  it("admits personal wipe for private scope and never claims shared-group wipe", async () => {
    const coverage = await Effect.runPromise(
      admitPersonalWipeTarget({
        conversationScope: null,
        chatKind: "private",
      })
    );

    expect(coverage.wiped).toEqual([
      "structured-profile",
      "bound-profile-notes",
    ]);
    expect(coverage.neverWiped).toContain("shared-group-memory");
    expect(sharedGroupMemoryModel.rules.personalWipeAffectsSharedGroup).toBe(
      false
    );
  });

  it("private sessions without group scope still admit personal memory (regression)", async () => {
    await expect(
      Effect.runPromise(
        admitPersonalMemoryAccess({
          conversationScope: null,
          chatKind: "private",
        })
      )
    ).resolves.toMatchObject({ kind: "personal" });

    await expect(
      Effect.runPromise(
        admitPersonalMemoryFromSession({
          principalId: "better-auth:user-1",
          principalType: "user",
          authenticator: "verified-channel",
          attributes: {
            conversationChannel: "telegram",
            conversationId: "11111111-1111-4111-8111-111111111111",
            workspaceId: "ws-1",
          },
        })
      )
    ).resolves.toMatchObject({ kind: "personal" });

    await expect(
      Effect.runPromise(admitPersonalMemoryFromSession(null))
    ).resolves.toMatchObject({ kind: "personal" });
  });

  it("shared-group stub never projects personal notes and isolates across groups", async () => {
    const stub = await Effect.runPromise(readSharedGroupMemoryStub(groupScope));
    expect(stub).toMatchObject({
      scope: groupScope,
      status: "stub",
      storage: "stub",
      documents: [],
      personalProjection: null,
    });

    const cross = await Effect.runPromise(
      admitSharedGroupMemoryRead({
        requestedScope: groupScope,
        sessionScope: otherGroupScope,
      }).pipe(Effect.flip)
    );

    expect(cross).toEqual(new PersonalMemoryError({ reason: "cross_scope" }));

    const same = await Effect.runPromise(
      admitSharedGroupMemoryRead({
        requestedScope: groupScope,
        sessionScope: groupScope,
      })
    );

    expect(same.personalProjection).toBeNull();
    expect(same.documents).toEqual([]);
  });

  it("malformed group: scopes fail closed for personal access", async () => {
    expect(parseConversationMemoryScope("group:not-a-valid").kind).toBe(
      "shared-group"
    );

    const error = await Effect.runPromise(
      admitPersonalMemoryAccess({
        conversationScope: "group:broken",
      }).pipe(Effect.flip)
    );

    expect(error).toEqual(new PersonalMemoryError({ reason: "cross_scope" }));
  });
});

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActionInputRejected,
  J1_DEFINITION_VERSION,
  acceptActionInput,
  acceptCommitmentAction,
  isCoSelectionLinkId,
  j1DefinitionArtifact,
  projectActionSurfaces,
  projectScopedSection,
  proposeCommitmentAction,
  recordOutcomeAction,
  type ActionHostBinding,
} from "./catalog";
import { definitionArtifactSchema } from "./definition";
import { selectRelevantContext } from "./recall/select";

const host: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "personal:alice",
};

const coworker: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "personal:alice",
};

describe("J1 definition catalog", () => {
  it("does project the same Action fields to tool and UI surfaces", () => {
    const surfaces = projectActionSurfaces(acceptCommitmentAction);
    expect(surfaces.definitionVersion).toBe(J1_DEFINITION_VERSION);
    expect(surfaces.tool.name).toBe(surfaces.ui.actionId);
    expect(surfaces.tool.parameters).toEqual(surfaces.ui.fields);
    expect(surfaces.tool.description).toBe(
      acceptCommitmentAction.def.description
    );
    expect(surfaces.tool.parameters.map((field) => field.name)).toEqual(
      Object.keys(acceptCommitmentAction.def.parametersSchema)
    );
    expect(j1DefinitionArtifact.definitionVersion).toBe(J1_DEFINITION_VERSION);
    expect(j1DefinitionArtifact.actions.map((action) => action.id)).toContain(
      "accept_commitment"
    );
  });

  it("does accept a valid propose-commitment payload for the host scope", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const accepted = yield* acceptActionInput(
          proposeCommitmentAction,
          host,
          {
            artifactRevision: "art_1",
            channelGrantId: "grant_mail",
            recipientHandle: "ana@example.com",
            title: "Send the red Q3 brief",
          }
        );
        expect(accepted.definitionVersion).toBe(J1_DEFINITION_VERSION);
        expect(accepted.host).toEqual(host);
        expect(accepted.parameters.title).toBe("Send the red Q3 brief");
      })
    ));

  it("does reject an invalid parameter type", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rejected = yield* acceptActionInput(
          proposeCommitmentAction,
          host,
          {
            artifactRevision: "art_1",
            channelGrantId: "grant_mail",
            recipientHandle: "ana@example.com",
            title: 1,
          }
        ).pipe(Effect.flip);
        expect(rejected).toBeInstanceOf(ActionInputRejected);
        expect(rejected.reason).toBe("invalid_parameter");
      })
    ));

  it("does reject a model-supplied host scope on the Action payload", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rejected = yield* acceptActionInput(
          proposeCommitmentAction,
          host,
          {
            artifactRevision: "art_1",
            channelGrantId: "grant_mail",
            recipientHandle: "ana@example.com",
            title: "Send the red Q3 brief",
            userId: "better-auth:bob",
            workspaceId: "personal:alice",
          }
        ).pipe(Effect.flip);
        expect(rejected).toBeInstanceOf(ActionInputRejected);
      })
    ));

  it("does reject an empty host scope", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rejected = yield* acceptActionInput(
          proposeCommitmentAction,
          { userId: "", workspaceId: host.workspaceId },
          {
            artifactRevision: "art_1",
            channelGrantId: "grant_mail",
            recipientHandle: "ana@example.com",
            title: "Send the red Q3 brief",
          }
        ).pipe(Effect.flip);
        expect(rejected).toBeInstanceOf(ActionInputRejected);
      })
    ));

  it("does not treat a provider receipt as obligation discharge", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const accepted = yield* acceptActionInput(recordOutcomeAction, host, {
          commitmentId: "cmt_1",
          providerReceiptId: "msg_9",
        });
        expect(accepted.parameters).toEqual({
          commitmentId: "cmt_1",
          providerReceiptId: "msg_9",
        });
        const rejected = yield* acceptActionInput(recordOutcomeAction, host, {
          commitmentId: "cmt_1",
          obligationDischarged: true,
          providerReceiptId: "msg_9",
        }).pipe(Effect.flip);
        expect(rejected).toBeInstanceOf(ActionInputRejected);
      })
    ));

  it("does not admit co-selection as a domain Link, identity, consent or grant", () => {
    for (const link of j1DefinitionArtifact.links) {
      expect(isCoSelectionLinkId(link.id)).toBe(false);
    }
    expect(j1DefinitionArtifact.links.map((link) => link.id)).toEqual([
      "commitment_recipient",
      "commitment_artifact",
    ]);
  });

  it("does key section projections by object, revision and host scope", () => {
    const section = {
      id: "ana-current",
      objectId: "commitment:ana",
      revision: "2",
    };
    expect(projectScopedSection(section, host)).toEqual({
      objectId: "commitment:ana",
      revision: "2",
      sourceId: "ana-current",
      userId: host.userId,
      workspaceId: host.workspaceId,
    });
    expect(projectScopedSection(section, coworker).userId).toBe(
      coworker.userId
    );
  });

  it("does not create domain Links or leak another audience from co-selection", () => {
    const result = selectRelevantContext({
      audience: "helper",
      budgetTokens: 64,
      currentAuthorityGeneration: 1,
      query: "salary compensation 180000 Ana agreement",
      requiredEvidence: [],
      sections: [
        {
          audience: "owner",
          authorityGeneration: 1,
          body: "Private salary number 180000 that another audience must not see.",
          eligibility: "eligible",
          id: "salary",
          objectId: "salary",
          revision: "1",
          title: "Compensation",
          tokenCost: 8,
        },
        {
          audience: "helper",
          authorityGeneration: 1,
          body: "Shared Ana agreement to send the red brief.",
          eligibility: "eligible",
          id: "brief",
          objectId: "brief",
          revision: "1",
          title: "Brief",
          tokenCost: 8,
        },
      ],
    });
    expect(result.createdLinks).toEqual([]);
    expect(result.relevant.map((row) => row.section.id)).toEqual(["brief"]);
    expect(result.relevant.map((row) => row.section.id)).not.toContain(
      "salary"
    );
  });
});

describe("definition artifact codec", () => {
  it("does round-trip the versioned J1 artifact", () => {
    const decoded = Schema.decodeUnknownSync(definitionArtifactSchema)(
      j1DefinitionArtifact
    );
    expect(decoded.definitionVersion).toBe(J1_DEFINITION_VERSION);
    expect(decoded.actions).toHaveLength(j1DefinitionArtifact.actions.length);
  });
});

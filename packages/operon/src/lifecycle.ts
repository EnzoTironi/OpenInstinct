import { Clock, Effect, Option, Schema } from "effect";

import type { InMemoryAuthority } from "./authority";
import {
  J1_DEFINITION_VERSION,
  acceptActionInput,
  actionHostBindingSchema,
  type ActionContract,
  type ActionHostBinding,
} from "./catalog";
import { computeCanonicalDigest } from "./digest";
import { generatePrefixedId } from "./types";

const j1ActionIdSchema = Schema.Literals([
  "accept_commitment",
  "prepare_delivery",
  "propose_commitment",
  "record_outcome",
]);

export const evidenceDispositionSchema = Schema.Literals([
  "available",
  "contradictory",
  "missing",
  "not_applicable",
  "stale",
  "unknown",
]);
export type EvidenceDisposition = typeof evidenceDispositionSchema.Type;

export const evidenceObservationKindSchema = Schema.Literals([
  "absent",
  "contradictory",
  "excluded",
  "inaccessible",
  "present",
  "stale",
]);
export type EvidenceObservationKind = typeof evidenceObservationKindSchema.Type;

export const evidenceObservationSchema = Schema.Struct({
  kind: evidenceObservationKindSchema,
  name: Schema.String.check(Schema.isMinLength(1)),
});
export type EvidenceObservation = typeof evidenceObservationSchema.Type;

export const repairNextSchema = Schema.Literals([
  "ask_user",
  "none",
  "refresh_source",
]);
export type RepairNext = typeof repairNextSchema.Type;

export const evidenceDiagnosticSchema = Schema.Struct({
  disposition: evidenceDispositionSchema,
  name: Schema.String,
  next: repairNextSchema,
});
export type EvidenceDiagnostic = typeof evidenceDiagnosticSchema.Type;

export const actionActorKindSchema = Schema.Literals(["agent", "user"]);
export type ActionActorKind = typeof actionActorKindSchema.Type;

export class ActionLifecycleRejected extends Schema.TaggedError<ActionLifecycleRejected>()(
  "ActionLifecycleRejected",
  {
    reason: Schema.Literals([
      "concurrent_conflict",
      "evidence_insufficient",
      "incoming_request_is_not_obligation",
      "playbook_not_admitted",
      "self_approval",
      "stale_approval",
      "stale_authority",
      "unbound_approval",
    ]),
    diagnostics: Schema.optionalKey(Schema.Array(evidenceDiagnosticSchema)),
  }
) {}

export interface ActionProposal<A> {
  readonly actionId: string;
  readonly authorityGeneration: number;
  readonly definitionVersion: string;
  readonly diagnostics: readonly EvidenceDiagnostic[];
  readonly host: ActionHostBinding;
  readonly parameterDigest: string;
  readonly parameters: A;
  readonly proposalId: string;
  readonly subjectId: string;
}

export interface ApprovalBinding {
  readonly actionId: string;
  readonly authorityGeneration: number;
  readonly host: ActionHostBinding;
  readonly parameterDigest: string;
  readonly proposalId: string;
}

export interface DecisionRecord {
  readonly actionId: string;
  readonly authorityGeneration: number;
  readonly disposition: "committed";
  readonly host: ActionHostBinding;
  readonly id: string;
  readonly parameterDigest: string;
  readonly recordedAt: number;
  readonly subjectId: string;
}

export interface RetrievedPlaybook {
  readonly admission: "admitted" | "proposal";
  readonly id: string;
  readonly text: string;
}

interface LifecycleState {
  readonly decisions: Map<string, DecisionRecord>;
  readonly locks: Map<string, true>;
  readonly playbooks: Map<string, RetrievedPlaybook>;
  readonly waits: Map<string, "open" | "resolved">;
  readonly commitments: Map<string, "open" | "completed">;
}

const jsonSchema = Schema.Json;

export function evaluateEvidence(
  observation: EvidenceObservation
): EvidenceDiagnostic {
  switch (observation.kind) {
    case "present":
      return {
        disposition: "available",
        name: observation.name,
        next: "none",
      };
    case "stale":
      return {
        disposition: "stale",
        name: observation.name,
        next: "refresh_source",
      };
    case "absent":
      return {
        disposition: "missing",
        name: observation.name,
        next: "ask_user",
      };
    case "inaccessible":
      return {
        disposition: "unknown",
        name: observation.name,
        next: "none",
      };
    case "excluded":
      return {
        disposition: "not_applicable",
        name: observation.name,
        next: "none",
      };
    case "contradictory":
      return {
        disposition: "contradictory",
        name: observation.name,
        next: "ask_user",
      };
    default: {
      const unexpected: never = observation.kind;
      return unexpected;
    }
  }
}

function reject(reason: ActionLifecycleRejected["reason"]) {
  return new ActionLifecycleRejected({ reason });
}

function digestParameters(actionId: string, parameters: Schema.Json): string {
  return computeCanonicalDigest({
    actionId,
    definitionVersion: J1_DEFINITION_VERSION,
    parameters,
  });
}

function subjectIdFrom(actionId: string, parameters: Schema.Json): string {
  const decoded = Schema.decodeUnknownOption(
    Schema.Struct({
      commitmentId: Schema.optionalKey(
        Schema.String.check(Schema.isMinLength(1))
      ),
    })
  )(parameters);
  if (Option.isSome(decoded) && decoded.value.commitmentId) {
    return decoded.value.commitmentId;
  }
  return `${actionId}:${generatePrefixedId("cmt")}`;
}

function operationalStatusFor(actionId: string): string | undefined {
  const decoded = Schema.decodeUnknownOption(j1ActionIdSchema)(actionId);
  if (Option.isNone(decoded)) {
    return undefined;
  }
  switch (decoded.value) {
    case "propose_commitment":
      return "proposed";
    case "accept_commitment":
      return "accepted";
    case "prepare_delivery":
      return "delivery_prepared";
    case "record_outcome":
      return undefined;
    default: {
      const unexpected: never = decoded.value;
      return unexpected;
    }
  }
}

function takeLock(state: LifecycleState, key: string): boolean {
  if (state.locks.has(key)) return false;
  state.locks.set(key, true);
  return true;
}

const prepareActionImpl = Effect.fn("InMemoryActionLifecycle.prepareAction")(
  function* <A>(
    contract: ActionContract<A>,
    host: ActionHostBinding,
    encoded: Schema.Json,
    observations: readonly EvidenceObservation[],
    authorityGeneration: number
  ) {
    yield* Schema.decodeUnknownEffect(actionHostBindingSchema)(host).pipe(
      Effect.mapError(() => reject("evidence_insufficient"))
    );
    const accepted = yield* acceptActionInput(contract, host, encoded);
    const byName = new Map(
      observations.map((observation) => [observation.name, observation])
    );
    const diagnostics = contract.requiredEvidence.map((name) => {
      const observation = byName.get(name);
      if (!observation) {
        return evaluateEvidence({ kind: "absent", name });
      }
      return evaluateEvidence(observation);
    });
    const blocked = diagnostics.filter(
      (row) =>
        row.disposition !== "available" && row.disposition !== "not_applicable"
    );
    if (blocked.length > 0) {
      return yield* new ActionLifecycleRejected({
        diagnostics,
        reason: "evidence_insufficient",
      });
    }
    const parameters = Schema.decodeUnknownSync(jsonSchema)(
      Schema.encodeUnknownSync(contract.parameters)(accepted.parameters)
    );
    const proposal: ActionProposal<A> = {
      actionId: accepted.actionId,
      authorityGeneration,
      definitionVersion: accepted.definitionVersion,
      diagnostics,
      host: accepted.host,
      parameterDigest: digestParameters(accepted.actionId, parameters),
      parameters: accepted.parameters,
      proposalId: generatePrefixedId("prp"),
      subjectId: subjectIdFrom(accepted.actionId, parameters),
    };
    return proposal;
  }
);

const issueHostApprovalImpl = Effect.fn(
  "InMemoryActionLifecycle.issueHostApproval"
)(function* <A>(
  proposal: ActionProposal<A>,
  actorKind: ActionActorKind,
  authorityGeneration: number
) {
  if (actorKind === "agent") {
    return yield* reject("self_approval");
  }
  if (proposal.authorityGeneration !== authorityGeneration) {
    return yield* reject("stale_authority");
  }
  const approval: ApprovalBinding = {
    actionId: proposal.actionId,
    authorityGeneration,
    host: proposal.host,
    parameterDigest: proposal.parameterDigest,
    proposalId: proposal.proposalId,
  };
  return approval;
});

const commitPreparedActionImpl = Effect.fn(
  "InMemoryActionLifecycle.commitPreparedAction"
)(function* <A>(
  state: LifecycleState,
  authority: InMemoryAuthority,
  proposal: ActionProposal<A>,
  approval: ApprovalBinding,
  authorityGeneration: number,
  expectedRevision: string
) {
  if (approval.proposalId !== proposal.proposalId) {
    return yield* reject("stale_approval");
  }
  if (approval.parameterDigest !== proposal.parameterDigest) {
    return yield* reject("stale_approval");
  }
  if (
    approval.host.userId !== proposal.host.userId ||
    approval.host.workspaceId !== proposal.host.workspaceId
  ) {
    return yield* reject("stale_approval");
  }
  if (
    approval.authorityGeneration !== authorityGeneration ||
    proposal.authorityGeneration !== authorityGeneration
  ) {
    return yield* reject("stale_authority");
  }
  const lockKey = `${proposal.host.workspaceId}\0${proposal.host.userId}\0${proposal.subjectId}`;
  if (!takeLock(state, lockKey)) {
    return yield* reject("concurrent_conflict");
  }
  return yield* Effect.gen(function* () {
    const status = operationalStatusFor(proposal.actionId);
    if (status) {
      yield* authority
        .applyOperationalTransition(
          proposal.host,
          proposal.subjectId,
          status,
          expectedRevision
        )
        .pipe(
          Effect.catchTags({
            AuthorityConflict: () => Effect.fail(reject("concurrent_conflict")),
            AuthorityInputRejected: () =>
              Effect.fail(reject("concurrent_conflict")),
          })
        );
    }
    if (proposal.actionId === "accept_commitment") {
      state.commitments.set(
        `${proposal.host.workspaceId}\0${proposal.host.userId}\0${proposal.subjectId}`,
        "open"
      );
    }
    const recordedAt = yield* Clock.currentTimeMillis;
    const record: DecisionRecord = {
      actionId: proposal.actionId,
      authorityGeneration,
      disposition: "committed",
      host: proposal.host,
      id: generatePrefixedId("dec", recordedAt),
      parameterDigest: proposal.parameterDigest,
      recordedAt,
      subjectId: proposal.subjectId,
    };
    state.decisions.set(record.id, record);
    return record;
  }).pipe(Effect.ensuring(Effect.sync(() => state.locks.delete(lockKey))));
});

export const bindChatYes = Effect.fail(reject("unbound_approval"));

const admitPlaybookImpl = Effect.fn("InMemoryActionLifecycle.admitPlaybook")(
  function* (
    state: LifecycleState,
    host: ActionHostBinding,
    playbookId: string
  ) {
    yield* Schema.decodeUnknownEffect(actionHostBindingSchema)(host).pipe(
      Effect.mapError(() => reject("playbook_not_admitted"))
    );
    const playbook = state.playbooks.get(playbookId);
    if (!playbook) {
      return yield* reject("playbook_not_admitted");
    }
    const admitted: RetrievedPlaybook = { ...playbook, admission: "admitted" };
    state.playbooks.set(playbookId, admitted);
    return admitted;
  }
);

const activatePlaybookImpl = Effect.fn(
  "InMemoryActionLifecycle.activatePlaybook"
)(function* (state: LifecycleState, playbookId: string) {
  const playbook = state.playbooks.get(playbookId);
  if (playbook?.admission !== "admitted") {
    return yield* reject("playbook_not_admitted");
  }
  return playbook;
});

export class InMemoryActionLifecycle {
  readonly #state: LifecycleState = {
    commitments: new Map(),
    decisions: new Map(),
    locks: new Map(),
    playbooks: new Map(),
    waits: new Map(),
  };

  prepareAction<A>(
    contract: ActionContract<A>,
    host: ActionHostBinding,
    encoded: Schema.Json,
    observations: readonly EvidenceObservation[],
    authorityGeneration: number
  ) {
    return prepareActionImpl(
      contract,
      host,
      encoded,
      observations,
      authorityGeneration
    );
  }

  issueHostApproval<A>(
    proposal: ActionProposal<A>,
    actorKind: ActionActorKind,
    authorityGeneration: number
  ) {
    return issueHostApprovalImpl(proposal, actorKind, authorityGeneration);
  }

  commitPreparedAction<A>(
    authority: InMemoryAuthority,
    proposal: ActionProposal<A>,
    approval: ApprovalBinding,
    authorityGeneration: number,
    expectedRevision: string
  ) {
    return commitPreparedActionImpl(
      this.#state,
      authority,
      proposal,
      approval,
      authorityGeneration,
      expectedRevision
    );
  }

  openWait(waitId: string) {
    this.#state.waits.set(waitId, "open");
  }

  openCommitment(commitmentId: string) {
    this.#state.commitments.set(commitmentId, "open");
  }

  resolveFollowUp(waitId: string) {
    if (this.#state.waits.get(waitId) === "open") {
      this.#state.waits.set(waitId, "resolved");
    }
  }

  waitStatus(waitId: string) {
    return this.#state.waits.get(waitId);
  }

  commitmentStatus(commitmentId: string) {
    return this.#state.commitments.get(commitmentId);
  }

  rememberRetrievedPlaybook(text: string): RetrievedPlaybook {
    const playbook: RetrievedPlaybook = {
      admission: "proposal",
      id: generatePrefixedId("pbk"),
      text,
    };
    this.#state.playbooks.set(playbook.id, playbook);
    return playbook;
  }

  admitPlaybook(host: ActionHostBinding, playbookId: string) {
    return admitPlaybookImpl(this.#state, host, playbookId);
  }

  activatePlaybook(playbookId: string) {
    return activatePlaybookImpl(this.#state, playbookId);
  }
}

export const refuseIncomingRequestAutoAccept = Effect.fail(
  reject("incoming_request_is_not_obligation")
);

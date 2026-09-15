import { Effect, Schema } from "effect";

import {
  actionDefSchema,
  definitionArtifactSchema,
  type ActionDef,
  type DefinitionArtifact,
} from "./definition";
import { CommonValueTypes } from "./value-types";

export const J1_DEFINITION_VERSION = "j1.0.0";

export const actionHostBindingSchema = Schema.Struct({
  userId: Schema.String.check(Schema.isMinLength(1)),
  workspaceId: Schema.String.check(Schema.isMinLength(1)),
});
export type ActionHostBinding = typeof actionHostBindingSchema.Type;

export class ActionInputRejected extends Schema.TaggedError<ActionInputRejected>()(
  "ActionInputRejected",
  {
    actionId: Schema.String,
    reason: Schema.Literal("invalid_parameter"),
  }
) {}

export interface ActionParameterField {
  readonly name: string;
  readonly type: "string";
  readonly required: boolean;
}

export interface ActionContract<A> {
  readonly def: ActionDef;
  readonly fields: readonly ActionParameterField[];
  readonly parameters: Schema.Codec<A, unknown>;
  readonly requiredEvidence: readonly string[];
}

export interface ActionSurfaces {
  readonly definitionVersion: string;
  readonly tool: {
    readonly name: string;
    readonly description: string;
    readonly parameters: readonly ActionParameterField[];
  };
  readonly ui: {
    readonly actionId: string;
    readonly title: string;
    readonly fields: readonly ActionParameterField[];
  };
}

export interface AcceptedActionInput<A> {
  readonly actionId: string;
  readonly definitionVersion: string;
  readonly host: ActionHostBinding;
  readonly parameters: A;
}

export interface ScopedSectionProjection {
  readonly objectId: string;
  readonly revision: string;
  readonly sourceId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

const actionParseOptions = { onExcessProperty: "error" } as const;

const requiredId = Schema.String.check(Schema.isMinLength(1));
const title = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(240)
);

const proposeCommitmentParameters = Schema.Struct({
  artifactRevision: requiredId,
  channelGrantId: requiredId,
  deadline: Schema.optionalKey(CommonValueTypes.ISO8601String.schema),
  recipientHandle: requiredId,
  title,
});
export type ProposeCommitmentParameters =
  typeof proposeCommitmentParameters.Type;

const acceptCommitmentParameters = Schema.Struct({
  artifactRevision: requiredId,
  commitmentId: requiredId,
});
export type AcceptCommitmentParameters = typeof acceptCommitmentParameters.Type;

const prepareDeliveryParameters = Schema.Struct({
  artifactRevision: requiredId,
  commitmentId: requiredId,
});
export type PrepareDeliveryParameters = typeof prepareDeliveryParameters.Type;

const recordOutcomeParameters = Schema.Struct({
  commitmentId: requiredId,
  providerReceiptId: requiredId,
});
export type RecordOutcomeParameters = typeof recordOutcomeParameters.Type;

function stringFields(
  names: readonly string[],
  optional: ReadonlySet<string> = new Set()
): readonly ActionParameterField[] {
  return names.map((name) => ({
    name,
    required: !optional.has(name),
    type: "string",
  }));
}

function actionDef(
  fields: readonly ActionParameterField[],
  rest: Omit<ActionDef, "parametersSchema">
): ActionDef {
  return Schema.decodeUnknownSync(actionDefSchema)({
    ...rest,
    parametersSchema: Object.fromEntries(
      fields.map((field) => [field.name, field.type])
    ),
  });
}

const proposeCommitmentFields = stringFields(
  [
    "title",
    "recipientHandle",
    "artifactRevision",
    "channelGrantId",
    "deadline",
  ],
  new Set(["deadline"])
);

const acceptCommitmentFields = stringFields([
  "commitmentId",
  "artifactRevision",
]);

const prepareDeliveryFields = stringFields([
  "commitmentId",
  "artifactRevision",
]);

const recordOutcomeFields = stringFields(["commitmentId", "providerReceiptId"]);

export const proposeCommitmentAction: ActionContract<ProposeCommitmentParameters> =
  {
    def: actionDef(proposeCommitmentFields, {
      description:
        "Record a proposed commitment. Host scope is not a model parameter.",
      effectClass: "state_mutation",
      id: "propose_commitment",
      name: "Propose commitment",
      requiredRoles: ["owner"],
      riskTier: "moderate",
    }),
    fields: proposeCommitmentFields,
    parameters: proposeCommitmentParameters,
    requiredEvidence: ["recipientHandle", "artifactRevision", "channelGrantId"],
  };

export const acceptCommitmentAction: ActionContract<AcceptCommitmentParameters> =
  {
    def: actionDef(acceptCommitmentFields, {
      description:
        "Accept a proposed commitment. Operational status changes only through this Action.",
      effectClass: "state_mutation",
      id: "accept_commitment",
      name: "Accept commitment",
      requiredRoles: ["owner"],
      riskTier: "high",
    }),
    fields: acceptCommitmentFields,
    parameters: acceptCommitmentParameters,
    requiredEvidence: ["commitmentId", "artifactRevision"],
  };

export const prepareDeliveryAction: ActionContract<PrepareDeliveryParameters> =
  {
    def: actionDef(prepareDeliveryFields, {
      description:
        "Prepare delivery against the current artifact revision. No external send.",
      effectClass: "state_mutation",
      id: "prepare_delivery",
      name: "Prepare delivery",
      requiredRoles: ["owner"],
      riskTier: "moderate",
    }),
    fields: prepareDeliveryFields,
    parameters: prepareDeliveryParameters,
    requiredEvidence: ["commitmentId", "artifactRevision"],
  };

export const recordOutcomeAction: ActionContract<RecordOutcomeParameters> = {
  def: actionDef(recordOutcomeFields, {
    description:
      "Record a provider receipt. This does not discharge the obligation.",
    effectClass: "state_mutation",
    id: "record_outcome",
    name: "Record outcome",
    requiredRoles: ["owner"],
    riskTier: "moderate",
  }),
  fields: recordOutcomeFields,
  parameters: recordOutcomeParameters,
  requiredEvidence: ["commitmentId", "providerReceiptId"],
};

export const j1Actions = [
  proposeCommitmentAction,
  acceptCommitmentAction,
  prepareDeliveryAction,
  recordOutcomeAction,
] as const;

export const j1DefinitionArtifact: DefinitionArtifact =
  Schema.decodeUnknownSync(definitionArtifactSchema)({
    actions: j1Actions.map((action) => action.def),
    definitionVersion: J1_DEFINITION_VERSION,
    links: [
      {
        cardinality: "1:1",
        id: "commitment_recipient",
        name: "Recipient handle",
        sourceTypeId: "commitment",
        targetTypeId: "contact_identity",
      },
      {
        cardinality: "1:1",
        id: "commitment_artifact",
        name: "Bound artifact revision",
        sourceTypeId: "commitment",
        targetTypeId: "artifact",
      },
    ],
    queries: [
      {
        description: "Commitments visible to the host-resolved user/workspace.",
        id: "commitments_for_scope",
        name: "Commitments for scope",
        parameters: {},
        returnTypeId: "commitment",
      },
      {
        description: "Required evidence R(d) for preparing a delivery.",
        id: "delivery_required_evidence",
        name: "Delivery required evidence",
        parameters: { commitmentId: "string" },
        returnTypeId: "commitment",
      },
    ],
    types: [
      {
        id: "commitment",
        name: "Commitment",
        primaryKey: "id",
        properties: {
          artifactRevision: {
            name: "artifactRevision",
            required: true,
            type: "string",
          },
          channelGrantId: {
            name: "channelGrantId",
            required: true,
            type: "string",
          },
          recipientHandle: {
            name: "recipientHandle",
            required: true,
            type: "string",
          },
          status: { name: "status", required: true, type: "string" },
          title: { name: "title", required: true, type: "string" },
          userId: { name: "userId", required: true, type: "string" },
          workspaceId: { name: "workspaceId", required: true, type: "string" },
        },
        typology: "transaction",
      },
      {
        id: "contact_identity",
        name: "Contact identity",
        primaryKey: "id",
        properties: {
          handle: { name: "handle", required: true, type: "string" },
        },
        typology: "reference",
      },
      {
        id: "artifact",
        name: "Artifact",
        primaryKey: "id",
        properties: {
          revision: { name: "revision", required: true, type: "string" },
        },
        typology: "transaction",
      },
    ],
  });

function rejectActionInput(actionId: string) {
  return new ActionInputRejected({
    actionId,
    reason: "invalid_parameter",
  });
}

export function projectActionSurfaces<A>(
  contract: ActionContract<A>
): ActionSurfaces {
  return {
    definitionVersion: J1_DEFINITION_VERSION,
    tool: {
      description: contract.def.description ?? contract.def.name,
      name: contract.def.id,
      parameters: contract.fields,
    },
    ui: {
      actionId: contract.def.id,
      fields: contract.fields,
      title: contract.def.name,
    },
  };
}

export const acceptActionInput = Effect.fn("acceptActionInput")(function* <A>(
  contract: ActionContract<A>,
  host: ActionHostBinding,
  encoded: Schema.Json
) {
  const boundHost = yield* Schema.decodeUnknownEffect(actionHostBindingSchema)(
    host
  ).pipe(Effect.mapError(() => rejectActionInput(contract.def.id)));
  const parameters = yield* Schema.decodeUnknownEffect(contract.parameters, {
    ...actionParseOptions,
  })(encoded).pipe(Effect.mapError(() => rejectActionInput(contract.def.id)));
  const accepted: AcceptedActionInput<A> = {
    actionId: contract.def.id,
    definitionVersion: J1_DEFINITION_VERSION,
    host: boundHost,
    parameters,
  };
  return accepted;
});

export function projectScopedSection(
  section: {
    readonly id: string;
    readonly objectId: string;
    readonly revision: string;
  },
  host: ActionHostBinding
): ScopedSectionProjection {
  return {
    objectId: section.objectId,
    revision: section.revision,
    sourceId: section.id,
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
}

export function isCoSelectionLinkId(linkId: string): boolean {
  return linkId === "co_selection" || linkId === "retrieved_with";
}

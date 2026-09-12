import { createHash, randomUUID } from "node:crypto";

import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

import {
  OperonBuilder,
  OperonMcpClient,
  OperonMcpError,
  type OperonToolClient,
  type OperonToolName,
  type ToolResult,
} from "./mcp-client";
import { deriveEmailIdentityKeys } from "./public-mail";

type Role = "consumer" | "builder";
type Json = typeof Schema.Json.Type;
type JsonObject = typeof Schema.JsonObject.Type;

interface SourceRow {
  readonly sourceId: string;
  readonly locator: string;
  readonly tenantId: string;
  readonly payload: readonly Json[];
  readonly receivedAt: number;
}

interface CandidateRow {
  readonly rawRecordId: string;
  readonly item: Json;
}

interface ReviewRow {
  readonly comments: string;
  readonly reviewedAt: number;
  readonly reviewerId: string;
  readonly verdict: "approve" | "reject" | "request_changes";
}

interface ProposalRow {
  readonly proposalId: string;
  readonly sourceIds: readonly string[];
  readonly digest: string;
  readonly status: "open" | "approved" | "merged";
  readonly confidence: number;
  readonly targetObjectTypeId: string;
  readonly records: readonly CandidateRow[];
  readonly authorId: string;
  readonly reviews: readonly ReviewRow[];
  readonly tenantId: string;
}

interface ObjectRow {
  readonly id: string;
  readonly typeId: string;
  readonly grade: "batch";
  readonly mappingProposalId: string;
  readonly proposalDigest: string;
}

interface Store {
  readonly sources: readonly SourceRow[];
  readonly proposals: readonly ProposalRow[];
  readonly objects: readonly ObjectRow[];
}

type Outcome =
  | { readonly ok: true; readonly store: Store; readonly result: Json }
  | { readonly ok: false; readonly error: OperonMcpError };

const emptyStore = (): Store => ({
  objects: [],
  proposals: [],
  sources: [],
});

const builderId = "companion-builder";

const security = (message: string) =>
  new OperonMcpError({ error: "McpSecurityError", message });

const fail = (error: string, message = "") =>
  new OperonMcpError({ error, message });

const ok = (body: Json): ToolResult => ({ body });

const err = (error: OperonMcpError): ToolResult => ({
  body: { error: error.error, message: error.message },
  isError: true,
});

const invalidArgs = (): Outcome => ({
  ok: false,
  error: fail("InvalidArgs", "invalid tool arguments"),
});

const IngestArgs = Schema.Struct({
  idempotencyKey: Schema.optionalKey(Schema.String),
  locator: Schema.optionalKey(Schema.String),
  payload: Schema.Array(Schema.Json),
  tenantId: Schema.optionalKey(Schema.String),
});

const ProposeArgs = Schema.Struct({
  primaryKeyField: Schema.optionalKey(Schema.String),
  sourceIds: Schema.Array(Schema.String),
  targetObjectTypeId: Schema.optionalKey(Schema.String),
  tenantId: Schema.optionalKey(Schema.String),
});

const ReviewArgs = Schema.Struct({
  comments: Schema.optionalKey(Schema.String),
  proposalId: Schema.String,
  reviewerId: Schema.String,
  verdict: Schema.Literals(["approve", "reject", "request_changes"]),
  viewedDigest: Schema.String,
});

const ProposalIdArgs = Schema.Struct({
  proposalId: Schema.String,
});

const SearchArgs = Schema.Struct({
  grade: Schema.optionalKey(Schema.String),
  tenantId: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
});

const EmailArgs = Schema.Struct({
  email: Schema.String,
});

const TypeArgs = Schema.Struct({
  typeId: Schema.String,
});

const AdmissionArgs = Schema.Struct({
  objectId: Schema.String,
  typeId: Schema.String,
});

const ItemFields = Schema.Struct({
  displayName: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
});

const decodeIngest = Schema.decodeUnknownOption(IngestArgs);
const decodePropose = Schema.decodeUnknownOption(ProposeArgs);
const decodeReview = Schema.decodeUnknownOption(ReviewArgs);
const decodeProposalId = Schema.decodeUnknownOption(ProposalIdArgs);
const decodeSearch = Schema.decodeUnknownOption(SearchArgs);
const decodeEmail = Schema.decodeUnknownOption(EmailArgs);
const decodeType = Schema.decodeUnknownOption(TypeArgs);
const decodeAdmission = Schema.decodeUnknownOption(AdmissionArgs);
const decodeItem = Schema.decodeUnknownOption(ItemFields);

const requireBuilder = (role: Role, operation: string) => {
  if (role === "builder") return Effect.void;
  return Effect.fail(
    security(`Consumer key cannot perform '${operation}'. Builder key required.`)
  );
};

const digestOf = (value: Json) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const tenantOf = (tenantId: string | undefined) => tenantId ?? "companion";

function ingestHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodeIngest(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const existing = store.sources.find(
        (source) => source.sourceId === (parsed.idempotencyKey ?? "")
      );
      if (existing)
        return {
          ok: true,
          result: { sourceArtifact: { sourceId: existing.sourceId } },
          store,
        };
      const source: SourceRow = {
        locator: parsed.locator ?? "",
        payload: parsed.payload,
        receivedAt: Date.now(),
        sourceId: parsed.idempotencyKey ?? randomUUID(),
        tenantId: tenantOf(parsed.tenantId),
      };
      return {
        ok: true,
        result: { sourceArtifact: { sourceId: source.sourceId } },
        store: { ...store, sources: [...store.sources, source] },
      };
    },
  });
}

function proposeHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodePropose(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const source = store.sources.find((row) =>
        parsed.sourceIds.includes(row.sourceId)
      );
      const records = source
        ? source.payload.map((item) => ({
            item,
            rawRecordId: itemKey(item, parsed.primaryKeyField ?? "email"),
          }))
        : [];
      const proposal: ProposalRow = {
        authorId: builderId,
        confidence: 1,
        digest: digestOf({ records, sourceIds: parsed.sourceIds }),
        proposalId: `prop_${String(Date.now())}`,
        records,
        reviews: [],
        sourceIds: parsed.sourceIds,
        status: "open",
        targetObjectTypeId: parsed.targetObjectTypeId ?? "Pessoa",
        tenantId: tenantOf(parsed.tenantId),
      };
      return {
        ok: true,
        result: {
          digest: proposal.digest,
          proposalId: proposal.proposalId,
          status: proposal.status,
        },
        store: { ...store, proposals: [...store.proposals, proposal] },
      };
    },
  });
}

function reviewHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodeReview(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const proposal = store.proposals.find(
        (row) => row.proposalId === parsed.proposalId
      );
      if (!proposal)
        return { ok: false, error: fail("NotFound", "proposal not found") };
      if (parsed.reviewerId === proposal.authorId)
        return { ok: false, error: fail("SelfReviewDeniedError") };
      if (parsed.viewedDigest !== proposal.digest)
        return { ok: false, error: fail("StaleReviewError") };
      const next: ProposalRow = {
        ...proposal,
        reviews: [
          ...proposal.reviews,
          {
            comments: parsed.comments ?? "",
            reviewedAt: Date.now(),
            reviewerId: parsed.reviewerId,
            verdict: parsed.verdict,
          },
        ],
        status: parsed.verdict === "approve" ? "approved" : proposal.status,
      };
      return {
        ok: true,
        result: {
          digest: next.digest,
          proposalId: next.proposalId,
          status: next.status,
        },
        store: replaceProposal(store, next),
      };
    },
  });
}

function admitHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodeProposalId(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const proposal = store.proposals.find(
        (row) => row.proposalId === parsed.proposalId
      );
      if (!proposal)
        return { ok: false, error: fail("NotFound", "proposal not found") };
      if (proposal.status !== "approved")
        return { ok: false, error: fail("ApprovalsPolicyViolationError") };
      const objects: ObjectRow[] = proposal.records.map((record) => ({
        grade: "batch",
        id: record.rawRecordId,
        mappingProposalId: proposal.proposalId,
        proposalDigest: proposal.digest,
        typeId: proposal.targetObjectTypeId,
      }));
      const next = { ...proposal, status: "merged" as const };
      return {
        ok: true,
        result: { proposalId: next.proposalId, status: next.status },
        store: {
          ...replaceProposal(store, next),
          objects: [...store.objects, ...objects],
        },
      };
    },
  });
}

function searchHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodeSearch(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const hits = [
        ...(parsed.grade === "candidate" ? [] : quarantineHits(store, parsed)),
        ...(parsed.grade === "quarantine" ? [] : candidateHits(store, parsed)),
      ];
      return { ok: true, result: { count: hits.length, hits }, store };
    },
  });
}

function deriveHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodeEmail(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const keys = deriveEmailIdentityKeys(parsed.email);
      if (Option.isNone(keys))
        return {
          ok: false,
          error: fail(
            "InvalidEmailAddress",
            `'${parsed.email}' is not an email address`
          ),
        };
      return { ok: true, result: keys.value, store };
    },
  });
}

function queryHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodeType(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const objects = store.objects.filter(
        (row) => row.typeId === parsed.typeId
      );
      return { ok: true, result: { count: objects.length, objects }, store };
    },
  });
}

function admissionHandler(store: Store, args: JsonObject): Outcome {
  return Option.match(decodeAdmission(args), {
    onNone: invalidArgs,
    onSome: (parsed) => {
      const found = store.objects.find(
        (row) => row.id === parsed.objectId && row.typeId === parsed.typeId
      );
      return {
        ok: true,
        result: {
          admission: found === undefined ? null : { grade: found.grade },
          objectId: parsed.objectId,
          typeId: parsed.typeId,
        },
        store,
      };
    },
  });
}

function itemKey(item: Json, primary: string) {
  const fields = decodeItem(item);
  if (Option.isNone(fields)) return "";
  if (primary === "displayName") return fields.value.displayName ?? "";
  return fields.value.email ?? "";
}

function matchesText(item: Json, text: string) {
  return text.length === 0 || JSON.stringify(item).toLowerCase().includes(text);
}

function quarantineHits(
  store: Store,
  args: typeof SearchArgs.Type
): readonly Json[] {
  const tenant = args.tenantId;
  const text = (args.text ?? "").toLowerCase();
  return store.sources.flatMap((source) => {
    if (tenant !== undefined && source.tenantId !== tenant) return [];
    return source.payload.flatMap((item, itemIndex) => {
      if (!matchesText(item, text)) return [];
      return [
        {
          admission: {
            grade: "quarantine",
            itemIndex,
            locator: source.locator,
            sourceId: source.sourceId,
          },
          item,
        },
      ];
    });
  });
}

function candidateHits(
  store: Store,
  args: typeof SearchArgs.Type
): readonly Json[] {
  const tenant = args.tenantId;
  const text = (args.text ?? "").toLowerCase();
  return store.proposals.flatMap((proposal) => {
    if (proposal.status !== "open") return [];
    if (tenant !== undefined && proposal.tenantId !== tenant) return [];
    return proposal.records.flatMap((record) => {
      if (!matchesText(record.item, text)) return [];
      return [
        {
          admission: {
            confidence: proposal.confidence,
            grade: "candidate",
            mappingProposalId: proposal.proposalId,
            proposalDigest: proposal.digest,
            rawRecordId: record.rawRecordId,
            reviewStage: "open",
            targetObjectTypeId: proposal.targetObjectTypeId,
          },
          item: record.item,
        },
      ];
    });
  });
}

function replaceProposal(store: Store, next: ProposalRow): Store {
  return {
    ...store,
    proposals: store.proposals.map((row) =>
      row.proposalId === next.proposalId ? next : row
    ),
  };
}

function handleTool(
  name: OperonToolName,
  store: Store,
  args: JsonObject
): Outcome {
  switch (name) {
    case "operon_admit_mapping_proposal":
      return admitHandler(store, args);
    case "operon_derive_identity_keys":
      return deriveHandler(store, args);
    case "operon_get_admission":
      return admissionHandler(store, args);
    case "operon_ingest_source":
      return ingestHandler(store, args);
    case "operon_propose_mapping":
      return proposeHandler(store, args);
    case "operon_query_objects":
      return queryHandler(store, args);
    case "operon_review_mapping_proposal":
      return reviewHandler(store, args);
    case "operon_search_quarantine":
      return searchHandler(store, args);
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

const builderTools = new Set<OperonToolName>([
  "operon_ingest_source",
  "operon_propose_mapping",
  "operon_review_mapping_proposal",
  "operon_admit_mapping_proposal",
]);

const runTool = (
  store: Ref.Ref<Store>,
  role: Role,
  name: OperonToolName,
  args: JsonObject
) =>
  Effect.gen(function* () {
    if (builderTools.has(name)) yield* requireBuilder(role, name);
    return yield* Ref.modify(store, (current) => {
      const next = handleTool(name, current, args);
      if (!next.ok) return [err(next.error), current] as const;
      return [ok(next.result), next.store] as const;
    });
  });

const clientFor = (store: Ref.Ref<Store>, role: Role): OperonToolClient => ({
  call: Effect.fn(`OperonMemory.${role}`)(function* (
    name: OperonToolName,
    args: JsonObject
  ) {
    return yield* runTool(store, role, name, args);
  }),
});

export const memoryLayer = Layer.effectContext(
  Effect.gen(function* () {
    const store = yield* Ref.make(emptyStore());
    return Context.empty().pipe(
      Context.add(OperonMcpClient, clientFor(store, "consumer")),
      Context.add(OperonBuilder, clientFor(store, "builder"))
    );
  })
);

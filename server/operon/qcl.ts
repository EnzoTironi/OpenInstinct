import { Context, Effect, Layer, Option, Schema } from "effect";

import {
  arrivedFromEmailLabel,
  builderOffCopy,
  cardCopy,
  connectCopy,
  emptyMailboxCopy,
  gmailGatewaySeamCopy,
  imapSeamCopy,
  invalidMailboxCopy,
  notAdmittedLabel,
  offerCopy,
  typeBudget,
} from "./copy";
import {
  cardCounts,
  ingestItems,
  parseMailbox,
  recentMessages,
  type MailboxSnapshot,
} from "./mailbox";
import { OperonBuilder, OperonMcpClient } from "./mcp-client";
import {
  deriveEmailIdentityKeys,
  type OrganizationDerivation,
} from "./public-mail";
import {
  SourceConnection,
  SourceError,
  type MailboxBytes,
  type SourceSpec,
} from "./source-connection";

export const ClassifiedPerson = Schema.Struct({
  displayName: Schema.String,
  email: Schema.String,
  origin: Schema.Literal(arrivedFromEmailLabel),
  type: Schema.Literal("Pessoa"),
  organization: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("derived"),
      type: Schema.Literal("Organização"),
      key: Schema.Struct({
        kind: Schema.Literal("domain"),
        value: Schema.String,
      }),
      confidence: Schema.Number,
    }),
    Schema.Struct({
      status: Schema.Literal("suppressed"),
      type: Schema.Literal(notAdmittedLabel),
      domain: Schema.String,
    }),
  ]),
});

export interface ClassifiedPerson
  extends Schema.Schema.Type<typeof ClassifiedPerson> {}

export const QuarantineCard = Schema.Struct({
  stage: Schema.Literal("quarantine"),
  copy: Schema.String,
  connectCopy: Schema.Literal(connectCopy),
  counts: Schema.Struct({
    companies: Schema.Number,
    conflicts: Schema.Number,
    conversations: Schema.Number,
    people: Schema.Number,
  }),
  items: Schema.Array(
    Schema.Struct({
      cc: Schema.Array(Schema.String),
      date: Schema.Number,
      displayName: Schema.String,
      email: Schema.String,
      threadId: Schema.String,
      to: Schema.Array(Schema.String),
    })
  ),
});

export interface QuarantineCard
  extends Schema.Schema.Type<typeof QuarantineCard> {}

export const ClassifyResult = Schema.Struct({
  stage: Schema.Literal("classify"),
  offerCopy: Schema.Literal(offerCopy),
  types: Schema.Array(Schema.String),
  people: Schema.Array(ClassifiedPerson),
  consumer: Schema.Literals(["linked", "unlinked"]),
});

export interface ClassifyResult
  extends Schema.Schema.Type<typeof ClassifyResult> {}

export const QclReady = Schema.TaggedStruct("QclReady", {
  card: QuarantineCard,
  classify: ClassifyResult,
});

export interface QclReady extends Schema.Schema.Type<typeof QclReady> {}

export const QclBlocked = Schema.TaggedStruct("QclBlocked", {
  copy: Schema.String,
  reason: Schema.Literals([
    "empty",
    "invalid",
    "imap_not_wired",
    "gmail_gateway_not_wired",
  ]),
});

export interface QclBlocked extends Schema.Schema.Type<typeof QclBlocked> {}

export const QclResult = Schema.Union([QclReady, QclBlocked]);

export type QclResult = typeof QclResult.Type;

export const LiberateOff = Schema.TaggedStruct("LiberateOff", {
  copy: Schema.Literal(builderOffCopy),
});

export const LiberateAdmitted = Schema.TaggedStruct("LiberateAdmitted", {
  body: Schema.Json,
});

export const LiberateResult = Schema.Union([LiberateOff, LiberateAdmitted]);

export type LiberateResult = typeof LiberateResult.Type;

const decodeBytes = new TextDecoder();

function copyForSource(error: SourceError) {
  switch (error.reason) {
    case "gmail_gateway_not_wired":
      return gmailGatewaySeamCopy;
    case "imap_not_wired":
      return imapSeamCopy;
    case "empty":
      return emptyMailboxCopy;
    default: {
      const _exhaustive: never = error.reason;
      return _exhaustive;
    }
  }
}

function organizationView(organization: OrganizationDerivation) {
  switch (organization.status) {
    case "derived":
      return {
        confidence: organization.confidence,
        key: organization.key,
        status: "derived" as const,
        type: "Organização" as const,
      };
    case "suppressed":
      return {
        domain: organization.domain,
        status: "suppressed" as const,
        type: notAdmittedLabel,
      };
    default: {
      const _exhaustive: never = organization;
      return _exhaustive;
    }
  }
}

function classifyPeople(snapshot: MailboxSnapshot): readonly ClassifiedPerson[] {
  const seen = new Set<string>();
  const people: ClassifiedPerson[] = [];
  for (const item of ingestItems(snapshot.messages, snapshot.ownerEmail)) {
    if (seen.has(item.email)) continue;
    const keys = deriveEmailIdentityKeys(item.email);
    if (Option.isNone(keys)) continue;
    seen.add(item.email);
    people.push({
      displayName: item.displayName,
      email: keys.value.person.key.value,
      organization: organizationView(keys.value.organization),
      origin: arrivedFromEmailLabel,
      type: "Pessoa",
    });
  }
  return people;
}

function cardOf(snapshot: MailboxSnapshot): QuarantineCard {
  const counts = cardCounts(snapshot.messages, snapshot.ownerEmail);
  return {
    connectCopy,
    copy: cardCopy(
      counts.conversations,
      counts.people,
      counts.companies,
      counts.conflicts
    ),
    counts,
    items: ingestItems(snapshot.messages, snapshot.ownerEmail),
    stage: "quarantine",
  };
}

function blocked(
  reason: QclBlocked["reason"],
  copy: string
): typeof QclBlocked.Type {
  return { _tag: "QclBlocked", copy, reason };
}

const snapshotFromBytes = Effect.fn("EmailQcl.snapshotFromBytes")(function* (
  bytes: MailboxBytes
) {
  const parsed = yield* parseMailbox(
    bytes.format,
    decodeBytes.decode(bytes.bytes)
  ).pipe(Effect.either);
  if (parsed._tag === "Left") {
    return {
      _tag: "blocked" as const,
      result: blocked(
        parsed.left.reason,
        parsed.left.reason === "empty" ? emptyMailboxCopy : invalidMailboxCopy
      ),
    };
  }
  const recent = yield* recentMessages(parsed.right);
  if (recent.length === 0) {
    return {
      _tag: "blocked" as const,
      result: blocked("empty", emptyMailboxCopy),
    };
  }
  const snapshot: MailboxSnapshot = {
    messages: recent,
    ...(parsed.right.ownerEmail === undefined
      ? {}
      : { ownerEmail: parsed.right.ownerEmail }),
  };
  return { _tag: "snapshot" as const, snapshot };
});

interface QclApi {
  readonly run: (spec: SourceSpec) => Effect.Effect<QclResult>;
  readonly liberate: (
    proposalId: string
  ) => Effect.Effect<LiberateResult, never>;
}

const makeEmailQcl = Effect.gen(function* () {
  const source = yield* SourceConnection;
  const consumer = yield* OperonMcpClient;
  const builder = yield* OperonBuilder;

  const run = Effect.fn("EmailQcl.run")(function* (spec: SourceSpec) {
    const bytes = yield* source.read(spec).pipe(Effect.either);
    if (bytes._tag === "Left") {
      return blocked(bytes.left.reason, copyForSource(bytes.left));
    }
    const loaded = yield* snapshotFromBytes(bytes.right);
    if (loaded._tag === "blocked") return loaded.result;
    const snapshot = loaded.snapshot;
    const search = yield* consumer
      .call("operon_search_quarantine", {})
      .pipe(Effect.either);
    const consumerState =
      search._tag === "Right" && search.right.isError !== true
        ? ("linked" as const)
        : ("unlinked" as const);
    return {
      _tag: "QclReady" as const,
      card: cardOf(snapshot),
      classify: {
        consumer: consumerState,
        offerCopy,
        people: classifyPeople(snapshot),
        stage: "classify" as const,
        types: [...typeBudget],
      },
    };
  });

  const liberate = Effect.fn("EmailQcl.liberate")(function* (
    proposalId: string
  ) {
    const admitted = yield* builder
      .call("operon_admit_mapping_proposal", { proposalId })
      .pipe(Effect.either);
    if (admitted._tag === "Left" || admitted.right.isError === true) {
      return { _tag: "LiberateOff" as const, copy: builderOffCopy };
    }
    return { _tag: "LiberateAdmitted" as const, body: admitted.right.body };
  });

  return EmailQcl.of({ liberate, run });
});

export class EmailQcl extends Context.Service<EmailQcl, QclApi>()(
  "companion/operon/EmailQcl"
) {
  static readonly layer = Layer.effect(EmailQcl, makeEmailQcl);
}

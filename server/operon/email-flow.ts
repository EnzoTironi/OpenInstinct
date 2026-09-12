import { Context, Effect, Layer, Predicate, Ref, Schema } from "effect";

import {
  arrivedFromEmailLabel,
  cardCopy,
  connectCopy,
  notAdmittedLabel,
  offerCopy,
  progressWithPercent,
} from "./copy";
import {
  cardCounts,
  ingestItems,
  parseMailbox,
  recentMessages,
  type MailboxSnapshot,
} from "./mailbox";
import { OperonBuilder, OperonMcpClient, OperonMcpError } from "./mcp-client";
import type { Actor } from "./principal";
import {
  SourceConnection,
  SourceError,
  type SourceSpec,
} from "./source-connection";

export class EmailFlowError extends Schema.TaggedError<EmailFlowError>()(
  "EmailFlowError",
  {
    reason: Schema.Literals([
      "no_source",
      "agents_cannot_approve",
      "stale_digest",
      "consumer_cannot_review",
      "unavailable",
    ]),
  }
) {}

export const SearchHit = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  label: Schema.Literal(notAdmittedLabel),
  source: Schema.Literal(arrivedFromEmailLabel),
  grade: Schema.Literals(["quarantine", "candidate"]),
});

export interface SearchHit extends Schema.Schema.Type<typeof SearchHit> {}

export const CardResult = Schema.Struct({
  card: Schema.String,
  conversations: Schema.Number,
  people: Schema.Number,
  companies: Schema.Number,
  conflicts: Schema.Number,
});

export interface CardResult extends Schema.Schema.Type<typeof CardResult> {}

export const SyncResult = Schema.Struct({
  progress: Schema.String,
  card: Schema.String,
  offer: Schema.Literal(offerCopy),
  digest: Schema.String,
  proposalId: Schema.String,
});

export interface SyncResult extends Schema.Schema.Type<typeof SyncResult> {}

const IngestBody = Schema.Struct({
  sourceArtifact: Schema.Struct({
    sourceId: Schema.String,
  }),
});

const ProposeBody = Schema.Struct({
  digest: Schema.String,
  proposalId: Schema.String,
});

const SearchBody = Schema.Struct({
  hits: Schema.Array(
    Schema.Struct({
      item: Schema.Struct({
        displayName: Schema.optionalKey(Schema.String),
        email: Schema.optionalKey(Schema.String),
      }),
      admission: Schema.Struct({
        grade: Schema.optionalKey(Schema.String),
      }),
    })
  ),
});

const decodeIngestBody = Schema.decodeUnknownEffect(IngestBody);
const decodeProposeBody = Schema.decodeUnknownEffect(ProposeBody);
const decodeSearchBody = Schema.decodeUnknownEffect(SearchBody);

interface Session {
  readonly spec: SourceSpec | null;
  readonly snapshot: MailboxSnapshot | null;
  readonly sourceId: string | null;
  readonly proposalId: string | null;
  readonly digest: string | null;
}

interface ToolBody {
  readonly body: typeof Schema.Json.Type;
  readonly isError?: boolean;
}

const emptySession = (): Session => ({
  digest: null,
  proposalId: null,
  snapshot: null,
  sourceId: null,
  spec: null,
});

const fromMailbox = (snapshot: MailboxSnapshot, owner?: string) => {
  const counts = cardCounts(snapshot.messages, owner);
  return {
    ...counts,
    card: cardCopy(
      counts.conversations,
      counts.people,
      counts.companies,
      counts.conflicts
    ),
  };
};

const requireSource = (session: Session) =>
  session.spec
    ? Effect.succeed(session.spec)
    : Effect.fail(new EmailFlowError({ reason: "no_source" }));

const loadSnapshot = Effect.fn("EmailFlow.loadSnapshot")(function* (
  spec: SourceSpec
) {
  const source = yield* SourceConnection;
  const bytes = yield* source.read(spec);
  const text = Buffer.from(bytes.bytes).toString("utf8");
  return yield* parseMailbox(bytes.format, text);
});

const requireToolBody = Effect.fn("EmailFlow.requireToolBody")(function* (
  result: ToolBody
) {
  if (result.isError === true)
    return yield* new EmailFlowError({ reason: "unavailable" });
  return result.body;
});

const readIngest = Effect.fn("EmailFlow.readIngest")(function* (
  result: ToolBody
) {
  const body = yield* requireToolBody(result);
  return yield* decodeIngestBody(body).pipe(
    Effect.mapError(() => new EmailFlowError({ reason: "unavailable" }))
  );
});

const readPropose = Effect.fn("EmailFlow.readPropose")(function* (
  result: ToolBody
) {
  const body = yield* requireToolBody(result);
  return yield* decodeProposeBody(body).pipe(
    Effect.mapError(() => new EmailFlowError({ reason: "unavailable" }))
  );
});

const readSearch = Effect.fn("EmailFlow.readSearch")(function* (
  result: ToolBody
) {
  const body = yield* requireToolBody(result);
  return yield* decodeSearchBody(body).pipe(
    Effect.mapError(() => new EmailFlowError({ reason: "unavailable" }))
  );
});

const ingestAndPropose = Effect.fn("EmailFlow.ingestAndPropose")(function* (
  snapshot: MailboxSnapshot
) {
  const builder = yield* OperonBuilder;
  const items = ingestItems(snapshot.messages, snapshot.ownerEmail);
  const ingested = yield* readIngest(
    yield* builder.call("operon_ingest_source", {
      idempotencyKey: "companion-email-30d",
      locator: "mailbox://upload/last-30-days",
      mediaType: "application/json",
      payload: items,
      tenantId: "companion",
    })
  );
  const proposed = yield* readPropose(
    yield* builder.call("operon_propose_mapping", {
      definitionDigest: "def_pessoa_v1",
      primaryKeyField: "email",
      propertyMappings: [
        { sourceField: "displayName", targetPropertyName: "displayName" },
        { sourceField: "email", targetPropertyName: "email" },
      ],
      sourceIds: [ingested.sourceArtifact.sourceId],
      targetObjectTypeId: "Pessoa",
      tenantId: "companion",
    })
  );
  return {
    digest: proposed.digest,
    proposalId: proposed.proposalId,
    sourceId: ingested.sourceArtifact.sourceId,
  };
});

const labelHits = (body: typeof SearchBody.Type): readonly SearchHit[] =>
  body.hits.map((hit) => ({
    email: hit.item.email ?? "",
    grade: hit.admission.grade === "candidate" ? "candidate" : "quarantine",
    label: notAdmittedLabel,
    name: hit.item.displayName ?? hit.item.email ?? "",
    source: arrivedFromEmailLabel,
  }));

const asPrincipal = (actor: Actor) =>
  Predicate.isTagged(actor, "Principal")
    ? Effect.succeed(actor)
    : Effect.fail(new EmailFlowError({ reason: "agents_cannot_approve" }));

interface Flow {
  readonly connect: () => Effect.Effect<string>;
  readonly attach: (spec: SourceSpec) => Effect.Effect<void, SourceError>;
  readonly preview: () => Effect.Effect<
    CardResult,
    EmailFlowError | SourceError
  >;
  readonly sync: () => Effect.Effect<
    SyncResult,
    EmailFlowError | SourceError | OperonMcpError,
    OperonBuilder
  >;
  readonly search: (
    name: string
  ) => Effect.Effect<readonly SearchHit[], EmailFlowError | OperonMcpError>;
  readonly offer: () => Effect.Effect<typeof offerCopy>;
  readonly confirm: (
    actor: Actor,
    digest: string
  ) => Effect.Effect<
    { readonly status: "merged"; readonly digest: string },
    EmailFlowError | OperonMcpError,
    OperonBuilder
  >;
}

const makeEmailFlow = Effect.gen(function* () {
  const session = yield* Ref.make(emptySession());
  const consumer = yield* OperonMcpClient;

  const attach = Effect.fn("EmailFlow.attach")(function* (spec: SourceSpec) {
    yield* Ref.update(session, (current) => ({ ...current, spec }));
  });

  const preview = Effect.fn("EmailFlow.preview")(function* () {
    const current = yield* Ref.get(session);
    const spec = yield* requireSource(current);
    const snapshot = yield* loadSnapshot(spec);
    const recent = { ...snapshot, messages: yield* recentMessages(snapshot) };
    yield* Ref.update(session, (value) => ({ ...value, snapshot: recent }));
    return fromMailbox(recent, recent.ownerEmail);
  });

  const sync = Effect.fn("EmailFlow.sync")(function* () {
    const card = yield* preview();
    const current = yield* Ref.get(session);
    if (!current.snapshot)
      return yield* new EmailFlowError({ reason: "no_source" });
    const linked = yield* ingestAndPropose(current.snapshot);
    yield* Ref.update(session, (value) => ({ ...value, ...linked }));
    return {
      card: card.card,
      digest: linked.digest,
      offer: offerCopy,
      progress: progressWithPercent(100),
      proposalId: linked.proposalId,
    };
  });

  const search = Effect.fn("EmailFlow.search")(function* (name: string) {
    const result = yield* consumer.call("operon_search_quarantine", {
      tenantId: "companion",
      text: name,
    });
    return labelHits(yield* readSearch(result));
  });

  const confirm = Effect.fn("EmailFlow.confirm")(function* (
    actor: Actor,
    digest: string
  ) {
    const principal = yield* asPrincipal(actor);
    const current = yield* Ref.get(session);
    if (!current.proposalId || current.digest !== digest)
      return yield* new EmailFlowError({ reason: "stale_digest" });
    const builder = yield* OperonBuilder;
    const reviewed = yield* builder.call("operon_review_mapping_proposal", {
      comments: offerCopy,
      proposalId: current.proposalId,
      reviewerId: principal.userId,
      reviewerRoles: ["owner"],
      verdict: "approve",
      viewedDigest: digest,
    });
    if (reviewed.isError === true)
      return yield* new EmailFlowError({ reason: "consumer_cannot_review" });
    const admitted = yield* builder.call("operon_admit_mapping_proposal", {
      proposalId: current.proposalId,
    });
    if (admitted.isError === true)
      return yield* new EmailFlowError({ reason: "unavailable" });
    return { digest, status: "merged" as const };
  });

  return EmailFlow.of({
    attach,
    confirm,
    connect: Effect.fn("EmailFlow.connect")(function* () {
      return connectCopy;
    }),
    offer: Effect.fn("EmailFlow.offer")(function* () {
      return offerCopy;
    }),
    preview,
    search,
    sync,
  });
});

export class EmailFlow extends Context.Service<EmailFlow, Flow>()(
  "companion/operon/EmailFlow"
) {
  static readonly layer = Layer.effect(EmailFlow, makeEmailFlow);
}

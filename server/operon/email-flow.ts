import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import {
  cardCopy,
  offerCopy,
  progressWithPercent,
  notAdmittedLabel,
  arrivedFromEmailLabel,
} from "./copy";
import {
  cardCounts,
  ingestItems,
  recentMessages,
  type MailboxSnapshot,
} from "./mailbox";
import { OperonMcpClient, type ToolResult } from "./mcp-client";

export class EmailFlowError extends Schema.TaggedError<EmailFlowError>()(
  "EmailFlowError",
  {
    reason: Schema.Literals(["stale_digest", "unavailable", "empty_mailbox"]),
  }
) {}
export interface PendingEmailProposal {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly digest: string;
}
const IngestBody = Schema.Struct({
  sourceArtifact: Schema.Struct({ sourceId: Schema.String }),
});
const ProposalBody = Schema.Struct({
  digest: Schema.String,
  proposalId: Schema.String,
  status: Schema.String,
});
const PersonFields = Schema.Struct({
  displayName: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
});
const SearchBody = Schema.Struct({
  hits: Schema.Array(
    Schema.Union([
      Schema.Struct({
        item: PersonFields,
        admission: Schema.Struct({ grade: Schema.Literal("quarantine") }),
      }),
      Schema.Struct({
        record: Schema.Struct({ properties: PersonFields }),
        admission: Schema.Struct({ grade: Schema.Literal("candidate") }),
      }),
    ])
  ),
});

function requireToolBody(result: ToolResult) {
  return result.isError === true
    ? Effect.fail(new EmailFlowError({ reason: "unavailable" }))
    : Effect.succeed(result.body);
}

/** No module-global account or proposal state: Operon persists data, Eve persists the pending offer. */
export const syncEmail = Effect.fn("syncEmail")(function* (
  snapshot: MailboxSnapshot
) {
  const messages = yield* recentMessages(snapshot);
  if (messages.length === 0)
    return yield* new EmailFlowError({ reason: "empty_mailbox" });
  const client = yield* OperonMcpClient;
  const items = ingestItems(messages, snapshot.ownerEmail);
  const revision = createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex");
  const ingested = yield* client
    .call("operon_ingest_source", {
      idempotencyKey: `email-30d:${revision}`,
      locator: `mailbox://last-30-days/${revision}`,
      mediaType: "application/json",
      payload: items,
    })
    .pipe(
      Effect.flatMap(requireToolBody),
      Effect.flatMap(Schema.decodeUnknownEffect(IngestBody))
    );
  const proposal = yield* client
    .call("operon_propose_mapping", {
      definitionDigest: "zoen-pessoa-v1",
      primaryKeyField: "email",
      targetObjectTypeId: "Pessoa",
      propertyMappings: [
        { sourceField: "displayName", targetPropertyName: "displayName" },
        { sourceField: "email", targetPropertyName: "email" },
      ],
      sourceIds: [ingested.sourceArtifact.sourceId],
    })
    .pipe(
      Effect.flatMap(requireToolBody),
      Effect.flatMap(Schema.decodeUnknownEffect(ProposalBody))
    );
  const counts = cardCounts(messages, snapshot.ownerEmail);
  return {
    card: cardCopy(
      counts.conversations,
      counts.people,
      counts.companies,
      counts.conflicts
    ),
    progress: progressWithPercent(100),
    offer: offerCopy,
    digest: proposal.digest,
    proposalId: proposal.proposalId,
    status: proposal.status,
  };
});

const registeredPeople = Effect.fn("registeredPeople")(function* (
  name: string
) {
  const client = yield* OperonMcpClient;
  const result = yield* client
    .call("operon_query_objects", { typeId: "Pessoa" })
    .pipe(
      Effect.flatMap(requireToolBody),
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            objects: Schema.Array(
              Schema.Struct({ id: Schema.String, properties: PersonFields })
            ),
          })
        )
      )
    );
  const query = name.trim().toLowerCase();
  const matching = result.objects.filter(
    ({ properties }) =>
      properties.email &&
      `${properties.displayName ?? ""} ${properties.email}`
        .toLowerCase()
        .includes(query)
  );
  const people = yield* Effect.forEach(
    matching,
    Effect.fn("registeredPeople.admission")(function* (person) {
      const receipt = yield* client
        .call("operon_get_admission", { typeId: "Pessoa", objectId: person.id })
        .pipe(
          Effect.flatMap(requireToolBody),
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                admission: Schema.NullOr(
                  Schema.Struct({
                    grade: Schema.Literals(["batch", "decision"]),
                  })
                ),
              })
            )
          )
        );
      if (!receipt.admission || !person.properties.email) return null;
      return {
        name: person.properties.displayName ?? person.properties.email,
        email: person.properties.email,
        label: "registrado",
        source: "Zoen",
        grade: receipt.admission.grade,
      };
    }),
    { concurrency: 1 }
  );
  return people.filter((person) => person !== null);
});

export const searchEmail = Effect.fn("searchEmail")(function* (name: string) {
  const client = yield* OperonMcpClient;
  const body = yield* client
    .call("operon_search_quarantine", { text: name })
    .pipe(
      Effect.flatMap(requireToolBody),
      Effect.flatMap(Schema.decodeUnknownEffect(SearchBody))
    );
  const people = new Map<
    string,
    {
      name: string;
      email: string;
      label: string;
      source: string;
      grade: "quarantine" | "candidate" | "batch" | "decision";
    }
  >();
  for (const hit of body.hits) {
    const person = "item" in hit ? hit.item : hit.record.properties;
    if (!person.email) continue;
    people.set(person.email, {
      name: person.displayName ?? person.email,
      email: person.email,
      label: notAdmittedLabel,
      source: arrivedFromEmailLabel,
      grade: hit.admission.grade,
    });
  }
  for (const person of yield* registeredPeople(name))
    people.set(person.email, person);
  return [...people.values()];
});

export const confirmEmail = Effect.fn("confirmEmail")(function* (
  pending: PendingEmailProposal,
  viewedDigest: string
) {
  if (pending.digest !== viewedDigest)
    return yield* new EmailFlowError({ reason: "stale_digest" });
  const client = yield* OperonMcpClient;
  yield* client
    .call("operon_review_mapping_proposal", {
      comments: offerCopy,
      proposalId: pending.proposalId,
      verdict: "approve",
      viewedDigest,
    })
    .pipe(Effect.flatMap(requireToolBody));
  const admitted = yield* client
    .call("operon_admit_mapping_proposal", { proposalId: pending.proposalId })
    .pipe(
      Effect.flatMap(requireToolBody),
      Effect.flatMap(Schema.decodeUnknownEffect(ProposalBody))
    );
  if (admitted.status !== "merged" || admitted.digest !== viewedDigest)
    return yield* new EmailFlowError({ reason: "unavailable" });
  return { status: admitted.status, digest: admitted.digest };
});

import { randomUUID } from "node:crypto";

import type { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";

import {
  ClaimChannelInputResponseSchema,
  type ClaimChannelInputResponse,
  decodeInput,
  IdentityInactive,
  InvalidMessage,
  MarkChannelInputResponseSchema,
} from "./model";

type ResponseRow = Pick<
  ClaimChannelInputResponse,
  "identityId" | "sourceMessageId" | "revision" | "decision" | "turnId"
> & {
  id: string;
  status: "attempted" | "accepted" | "uncertain";
};


function isActiveIdentity(row: { readonly active: boolean } | undefined) {
  return row?.active === true;
}

function isUniqueSource(sources: readonly { readonly id: string }[]) {
  return sources.length === 1 && sources[0] !== undefined;
}

function isSameInputResponse(
  previous: {
    readonly identityId: string;
    readonly sourceMessageId: string;
    readonly revision: string;
    readonly decision: string;
    readonly turnId: string;
  },
  value: {
    readonly identityId: string;
    readonly sourceMessageId: string;
    readonly revision: string;
    readonly decision: string;
    readonly turnId: string;
  }
) {
  return (
    previous.identityId === value.identityId &&
    previous.sourceMessageId === value.sourceMessageId &&
    previous.revision === value.revision &&
    previous.decision === value.decision &&
    previous.turnId === value.turnId
  );
}

export function createInputResponses(sql: PgClient.PgClient) {
  const claim = Effect.fn("Messaging.claimChannelInputResponse")(function* (
    input: ClaimChannelInputResponse
  ) {
    const value = yield* decodeInput(ClaimChannelInputResponseSchema)(input);

    const identities = yield* sql<{
      active: boolean;
    }>`SELECT revoked_at IS NULL AS active
      FROM channel_identity WHERE id = ${value.identityId} FOR UPDATE`;

    if (!isActiveIdentity(identities[0]))
      return yield* new IdentityInactive({ identityId: value.identityId });

    const sources = yield* sql<{ id: string }>`SELECT id FROM channel_inbox
      WHERE identity_id = ${value.identityId} AND session_id = ${value.sessionId}
      AND source_message_id = ${value.sourceMessageId} AND status = 'accepted' LIMIT 2`;

    const source = sources[0];

    if (!isUniqueSource(sources) || !source) {
      return yield* new InvalidMessage({
        message:
          "Response requires one accepted source message in this session.",
      });
    }

    const inserted = yield* sql<{
      id: string;
    }>`INSERT INTO channel_input_response
      (id, identity_id, inbox_id, session_id, source_message_id, request_id, revision, decision, turn_id)
      VALUES (${randomUUID()}, ${value.identityId}, ${source.id}, ${value.sessionId},
        ${value.sourceMessageId}, ${value.requestId}, ${value.revision}, ${value.decision}, ${value.turnId})
      ON CONFLICT (session_id, request_id) DO NOTHING RETURNING id`;

    if (inserted[0])
      return {
        kind: "acquired" as const,
        id: inserted[0].id,
        status: "attempted" as const,
      };

    const rows = yield* sql<ResponseRow>`SELECT id, identity_id AS "identityId",
      source_message_id AS "sourceMessageId", revision, decision, turn_id AS "turnId", status
      FROM channel_input_response WHERE session_id = ${value.sessionId} AND request_id = ${value.requestId}`;

    const previous = rows[0];

    if (!previous)
      return yield* new InvalidMessage({
        message: "Response claim disappeared.",
      });

    return {
      kind: isSameInputResponse(previous, value)
        ? ("duplicate" as const)
        : ("conflict" as const),
      id: previous.id,
      status: previous.status,
    };
  }, sql.withTransaction);

  const mark = Effect.fn("Messaging.markChannelInputResponse")(function* (
    input: typeof MarkChannelInputResponseSchema.Type
  ) {
    const value = yield* decodeInput(MarkChannelInputResponseSchema)(input);

    const rows = yield* sql<{ id: string }>`UPDATE channel_input_response
      SET status = ${value.status}, completed_at = clock_timestamp()
      WHERE id = ${value.id} AND status = 'attempted' RETURNING id`;

    return rows.length === 1;
  });

  return { claim, mark };
}

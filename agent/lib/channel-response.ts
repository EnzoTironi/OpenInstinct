import { PgClient } from "@effect/sql-pg";
import { Effect, Exit, Schema } from "effect";
import type { Session } from "eve/channels";
import type { MessageStreamEvent } from "eve/client";

import { channelPrincipal } from "../../server/channels/principal";
import { ChannelTransport } from "../../server/channels/transport";
import type { internalCallbackBodies } from "../../server/internal/callback-auth";
import { Messaging, MessagePayloadSchema } from "../../server/messaging";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import {
  channelConsentRevision,
  validateChannelConsent,
} from "./channel-consent";
import { readChannelInputs } from "./channel-input";

const decodeChannelProviderSchema = Schema.decodeUnknownEffect(
  channelProviderSchema
);

const decodeMessagePayloadSchema =
  Schema.decodeUnknownEffect(MessagePayloadSchema);

type ResponseInput =
  (typeof internalCallbackBodies)["/internal/channel-input/respond"]["Type"];

class ChannelResponseRejected extends Schema.TaggedError<ChannelResponseRejected>()(
  "ChannelResponseRejected",
  { reason: Schema.String }
) {}

class ChannelResponseUncertain extends Schema.TaggedError<ChannelResponseUncertain>()(
  "ChannelResponseUncertain",
  {}
) {}

const readResponseIdentity = Effect.fn("readResponseIdentity")(function* (
  identityId: string
) {
  const sql = yield* PgClient.PgClient;

  const rows =
    yield* sql`SELECT channel FROM channel_identity WHERE id = ${identityId}`;

  const channel = yield* decodeChannelProviderSchema(rows[0]?.channel);

  const transport = yield* ChannelTransport;

  return yield* transport.activeIdentity(identityId, channel);
});

export const readChannelResponseContext = Effect.fn(
  "readChannelResponseContext"
)(function* (input: ResponseInput) {
  const identity = yield* readResponseIdentity(input.identityId);
  const sql = yield* PgClient.PgClient;

  const rows = yield* sql`SELECT payload FROM channel_inbox
    WHERE identity_id = ${input.identityId} AND source_message_id = ${input.sourceMessageId}
      AND status = 'accepted' AND session_id = ${input.sessionId} LIMIT 2`;

  if (rows.length !== 1) {
    return yield* new ChannelResponseRejected({ reason: "invalid_source" });
  }

  const payload = yield* decodeMessagePayloadSchema(rows[0]?.payload);

  if (!payload.text || payload.sourceOccurredAtMs === undefined) {
    return yield* new ChannelResponseRejected({ reason: "invalid_source" });
  }

  const source = {
    identityId: input.identityId,
    sessionId: input.sessionId,
    sourceMessageId: input.sourceMessageId,
    text: payload.text,
    sourceOccurredAtMs: payload.sourceOccurredAtMs,
  };

  return { identity, source };
});

interface TurnStreamState {
  activeTurnId: string | undefined;
  matchingMessages: number;
  exactText: boolean;
  closed: boolean;
}

function applyChannelResponseStreamEvent(
  state: TurnStreamState,
  event: MessageStreamEvent,
  source: { readonly turnId: string; readonly text: string }
) {
  if (event.type === "turn.started") state.activeTurnId = event.data.turnId;

  if (
    event.type === "message.received" &&
    event.data.turnId === source.turnId
  ) {
    state.matchingMessages++;
    state.exactText = event.data.message === source.text;
  }

  if (
    (event.type === "turn.completed" ||
      event.type === "turn.cancelled" ||
      event.type === "turn.failed") &&
    event.data.turnId === source.turnId
  )
    state.closed = true;
}

export async function readChannelResponseTurnStream(
  stream: ReadableStream<MessageStreamEvent>,
  tail: number,
  source: { readonly turnId: string; readonly text: string },
  signal: AbortSignal
) {
  const reader = stream.getReader();

  const cancel = () => {
    void reader.cancel();
  };

  signal.addEventListener("abort", cancel, { once: true });

  const state: TurnStreamState = {
    activeTurnId: undefined,
    matchingMessages: 0,
    exactText: false,
    closed: false,
  };

  try {
    for (let index = 0; index <= tail; index++) {
      signal.throwIfAborted();
      // oxlint-disable-next-line eslint/no-await-in-loop
      const item = await reader.read();

      if (item.done)
        throw new Error("Session stream ended before its captured tail.");

      applyChannelResponseStreamEvent(state, item.value, source);
    }

    signal.throwIfAborted();

    return (
      state.activeTurnId === source.turnId &&
      state.matchingMessages === 1 &&
      state.exactText &&
      !state.closed
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel();
  }
}

const requireResponseTurn = Effect.fn("requireResponseTurn")(function* (
  session: Session,
  source: { readonly turnId: string; readonly text: string }
) {
  const matches = yield* Effect.tryPromise({
    try: async (signal) => {
      const tail = await session.getStreamTailIndex();

      if (tail < 0) return false;

      return readChannelResponseTurnStream(
        await session.getEventStream({ startIndex: 0 }),
        tail,
        source,
        signal
      );
    },
    catch: () => new ChannelResponseRejected({ reason: "turn_unavailable" }),
  });

  if (!matches)
    return yield* new ChannelResponseRejected({
      reason: "source_turn_mismatch",
    });

  return undefined;
});

const prepareChannelResponse = Effect.fn("prepareChannelResponse")(function* (
  input: ResponseInput,
  session: Session
) {
  if (session.id !== input.sessionId) {
    return yield* new ChannelResponseRejected({ reason: "session_mismatch" });
  }

  const { identity, source } = yield* readChannelResponseContext(input);
  yield* requireResponseTurn(session, {
    turnId: input.turnId,
    text: source.text,
  });

  const pending = yield* Effect.tryPromise({
    try: (signal) => readChannelInputs(session, signal),
    catch: () => new ChannelResponseRejected({ reason: "pending_unavailable" }),
  }).pipe(Effect.timeout("8 seconds"));

  const request = pending.find(
    (candidate) => candidate.requestId === input.requestId
  );

  if (!request)
    return yield* new ChannelResponseRejected({ reason: "stale_request" });

  const reference = {
    requestId: request.requestId,
    revision: channelConsentRevision(request),
  };

  const transport = yield* ChannelTransport;

  const delivery = yield* transport.deliveredInput(identity.id, {
    ...reference,
    sessionId: session.id,
  });

  const decision = validateChannelConsent(
    source,
    {
      sourceMessageId: source.sourceMessageId,
      sourceText: source.text,
      candidate: { intent: input.decision, references: [reference] },
    },
    {
      identityId: identity.id,
      sessionId: session.id,
      pending,
      deliveries: delivery ? [delivery] : [],
      consumedSourceMessageIds: [],
    }
  );

  if (decision.status !== "validated") {
    return yield* new ChannelResponseRejected({
      reason:
        decision.status === "rejected" ? decision.reason : "invalid_decision",
    });
  }

  return {
    decision,
    auth: channelPrincipal(identity, source.sourceMessageId),
  };
});

export const submitChannelResponse = Effect.fn("submitChannelResponse")(
  function* (input: ResponseInput, session: Session) {
    const prepared = yield* prepareChannelResponse(input, session).pipe(
      Effect.timeout("8 seconds")
    );

    const messaging = yield* Messaging;

    const claim = yield* messaging.claimChannelInputResponse({
      ...input,
      revision: prepared.decision.binding.revision,
    });

    if (claim.kind === "conflict") {
      return yield* new ChannelResponseRejected({
        reason: "response_conflict",
      });
    }

    if (claim.kind === "duplicate") {
      if (claim.status === "accepted") return undefined;

      return yield* new ChannelResponseUncertain();
    }

    yield* Effect.gen(function* () {
      const current = yield* prepareChannelResponse(input, session);

      if (
        current.decision.binding.revision !== prepared.decision.binding.revision
      ) {
        return yield* new ChannelResponseRejected({ reason: "stale_revision" });
      }

      const result = yield* Effect.tryPromise({
        try: () =>
          session.respond([current.decision.response], { auth: current.auth }),
        catch: () => new ChannelResponseUncertain(),
      });

      if (result.status !== "accepted" || result.sessionId !== session.id) {
        return yield* new ChannelResponseUncertain();
      }

      const marked = yield* messaging.markChannelInputResponse({
        id: claim.id,
        status: "accepted",
      });

      if (!marked) return yield* new ChannelResponseUncertain();

      return undefined;
    }).pipe(
      Effect.timeout("8 seconds"),
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? messaging.markChannelInputResponse({
              id: claim.id,
              status: "uncertain",
            })
          : Effect.void
      )
    );

    return undefined;
  }
);

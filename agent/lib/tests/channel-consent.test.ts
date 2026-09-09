import { describe, expect, test } from "vitest";
import type { InputRequest } from "eve/client";
import {
  channelConsentRevision,
  validateChannelConsent,
  type ChannelConsentDelivery,
  type ChannelConsentInterpretation,
  type ChannelConsentSnapshot,
  type ChannelConsentSource,
} from "../channel-consent";

const request: InputRequest = {
  requestId: "request-original",
  kind: "tool-approval",
  prompt: "enviar convite para quinta, às 10h, horário de Brasília?",
  display: "confirmation",
  action: {
    kind: "tool-call",
    callId: "call-original",
    toolName: "calendar-create-event",
    input: {
      start: "2026-09-10T10:00:00-03:00",
      attendees: ["invitee@example.com"],
    },
  },
  options: [
    { id: "approve", label: "Aprovar" },
    { id: "cancel", label: "Cancelar" },
  ],
};
const source: ChannelConsentSource = {
  sourceMessageId: "message-response",
  identityId: "native-identity",
  sessionId: "session-owner",
  text: "pode enviar",
  sourceOccurredAtMs: 20_000,
};
const delivered: ChannelConsentDelivery = {
  receiptId: "provider-receipt",
  providerMessageIds: ["provider-receipt"],
  text: "enviar convite para quinta, às 10h, horário de Brasília?",
  identityId: source.identityId,
  sessionId: source.sessionId,
  requestId: request.requestId,
  revision: channelConsentRevision(request),
  deliveredAtMs: 10_000,
};
const snapshot: ChannelConsentSnapshot = {
  identityId: source.identityId,
  sessionId: source.sessionId,
  pending: [request],
  deliveries: [delivered],
  consumedSourceMessageIds: [],
};
const interpretation: ChannelConsentInterpretation = {
  sourceMessageId: source.sourceMessageId,
  sourceText: source.text,
  candidate: {
    intent: "approve",
    references: [
      { requestId: request.requestId, revision: delivered.revision },
    ],
  },
};

const rejected = (reason: string) => ({ status: "rejected", reason });

describe("a decision belongs to its verified source and exact delivered proposal", () => {
  test("returns an Eve response and caller-owned binding, without changing the snapshot", () => {
    const before = structuredClone(snapshot);
    expect(validateChannelConsent(source, interpretation, snapshot)).toEqual({
      status: "validated",
      intent: "approve",
      binding: {
        ...source,
        requestId: request.requestId,
        revision: delivered.revision,
        deliveryReceiptId: delivered.receiptId,
        deliveryProviderMessageIds: delivered.providerMessageIds,
      },
      response: { requestId: request.requestId, optionId: "approve" },
    });
    expect(snapshot).toEqual(before);
  });

  test.each(["cancel", "correct"])(
    "%s only denies the original action",
    (intent) => {
      const text =
        intent === "correct" ? "sim, mas às onze" : "deixa, não envia";
      expect(
        validateChannelConsent(
          { ...source, text },
          {
            ...interpretation,
            sourceText: text,
            candidate: {
              intent,
              references: [
                { requestId: request.requestId, revision: delivered.revision },
              ],
            },
          },
          snapshot
        )
      ).toMatchObject({
        status: "validated",
        intent,
        response: { requestId: request.requestId, optionId: "cancel" },
      });
    }
  );

  test.each(["clarify", "conversation"])(
    "%s has no response even when the text contains approval words",
    (intent) => {
      const text = "ela disse sim; pode mandar é o nome da música";
      expect(
        validateChannelConsent(
          { ...source, text },
          {
            ...interpretation,
            sourceText: text,
            candidate: { intent, references: [] },
          },
          snapshot
        )
      ).toEqual({ status: "non_action", intent });
    }
  );

  test.each([
    { sourceMessageId: "other-message" },
    { sourceText: "pode enviar, mas amanhã" },
    { sourceText: "pode enviar " },
  ])(
    "rejects an interpretation detached from its complete source: %j",
    (change) => {
      expect(
        validateChannelConsent(
          source,
          { ...interpretation, ...change },
          snapshot
        )
      ).toEqual(rejected("source_mismatch"));
    }
  );

  test.each([{ identityId: "other-owner" }, { sessionId: "other-session" }])(
    "rejects a snapshot from another scope: %j",
    (change) => {
      expect(
        validateChannelConsent(source, interpretation, {
          ...snapshot,
          ...change,
        })
      ).toEqual(rejected("scope_mismatch"));
    }
  );

  test("a still-visible request cannot reuse a source already consumed as a decision", () => {
    expect(
      validateChannelConsent(source, interpretation, {
        ...snapshot,
        consumedSourceMessageIds: [source.sourceMessageId],
      })
    ).toEqual(rejected("replayed_source"));
  });

  test.each([
    { intent: "approve", references: [], actor: "native-identity" },
    { intent: "approve", references: [], destination: "someone-else" },
    { intent: "correct", references: [], newArguments: { start: "tomorrow" } },
    {
      intent: "approve",
      references: [
        {
          requestId: request.requestId,
          revision: delivered.revision,
          actor: "native-identity",
        },
      ],
    },
    { intent: "allow", references: [] },
    {
      intent: "conversation",
      references: [
        { requestId: request.requestId, revision: delivered.revision },
      ],
    },
  ])(
    "rejects extra authority, replacement arguments and invalid candidates: %j",
    (candidate) => {
      expect(
        validateChannelConsent(
          source,
          { ...interpretation, candidate },
          snapshot
        )
      ).toEqual(rejected("invalid_candidate"));
    }
  );
});

describe("pending identity, revision and delivery are independent requirements", () => {
  test("an explicit single target can resolve the older of two different pending proposals", () => {
    const newer = { ...request, requestId: "newer-request" };
    expect(
      validateChannelConsent(source, interpretation, {
        ...snapshot,
        pending: [newer, request],
        deliveries: [
          {
            ...delivered,
            requestId: newer.requestId,
            revision: channelConsentRevision(newer),
            receiptId: "newer-receipt",
            providerMessageIds: ["newer-receipt"],
          },
          delivered,
        ],
      })
    ).toMatchObject({
      status: "validated",
      response: { requestId: request.requestId },
    });
  });

  test.each([[], [request, request]].map((pending) => ({ pending })))(
    "refuses missing or duplicate current request identities",
    ({ pending }) => {
      expect(
        validateChannelConsent(source, interpretation, { ...snapshot, pending })
      ).toEqual(
        rejected(pending.length ? "ambiguous_reference" : "stale_request")
      );
    }
  );

  test.each(
    [[], [request.requestId, "another-request"]].map((ids) => ({ ids }))
  )("never selects a target from missing or multiple references", ({ ids }) => {
    expect(
      validateChannelConsent(
        source,
        {
          ...interpretation,
          candidate: {
            intent: "approve",
            references: ids.map((requestId) => ({
              requestId,
              revision: delivered.revision,
            })),
          },
        },
        snapshot
      )
    ).toEqual(rejected("ambiguous_reference"));
  });

  test("changed arguments invalidate old consent even if the request ID is reused", () => {
    const corrected = {
      ...request,
      action: {
        ...request.action,
        input: { ...request.action.input, start: "2026-09-10T11:00:00-03:00" },
      },
    };
    expect(
      validateChannelConsent(source, interpretation, {
        ...snapshot,
        pending: [corrected],
      })
    ).toEqual(rejected("stale_revision"));
    expect(
      validateChannelConsent(
        source,
        {
          ...interpretation,
          candidate: {
            intent: "approve",
            references: [
              {
                requestId: corrected.requestId,
                revision: channelConsentRevision(corrected),
              },
            ],
          },
        },
        { ...snapshot, pending: [corrected] }
      )
    ).toEqual(rejected("missing_delivery"));
  });

  test.each(
    [
      [],
      [{ ...delivered, identityId: "different-identity" }],
      [{ ...delivered, sessionId: "different-session" }],
      [{ ...delivered, requestId: "different-request" }],
      [{ ...delivered, revision: "old-revision" }],
      [{ ...delivered, providerMessageIds: [] }],
    ].map((deliveries) => ({ deliveries }))
  )(
    "rejects missing or mismatched confirmed delivery: %j",
    ({ deliveries }) => {
      expect(
        validateChannelConsent(source, interpretation, {
          ...snapshot,
          deliveries,
        })
      ).toEqual(rejected("missing_delivery"));
    }
  );

  test("does not choose between duplicate delivery claims", () => {
    expect(
      validateChannelConsent(source, interpretation, {
        ...snapshot,
        deliveries: [
          delivered,
          { ...delivered, providerMessageIds: ["another-receipt"] },
        ],
      })
    ).toEqual(rejected("ambiguous_delivery"));
  });

  test.each([20_000, 20_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "receipt time %s does not prove delivery before the reply",
    (deliveredAtMs) => {
      expect(
        validateChannelConsent(source, interpretation, {
          ...snapshot,
          deliveries: [{ ...delivered, deliveredAtMs }],
        })
      ).toEqual(rejected("delivery_not_before_source"));
    }
  );

  test("delayed intake cannot turn a pre-proposal message into consent", () => {
    expect(
      validateChannelConsent(
        { ...source, sourceOccurredAtMs: 9_000 },
        interpretation,
        snapshot
      )
    ).toEqual(rejected("delivery_not_before_source"));
  });

  test.each([
    { ...request, kind: "question" as const },
    { ...request, options: [] },
  ])(
    "does not approve other request kinds or invent missing choices",
    (pending) => {
      const currentRevision = channelConsentRevision(pending);
      expect(
        validateChannelConsent(
          source,
          {
            ...interpretation,
            candidate: {
              intent: "approve",
              references: [
                { requestId: pending.requestId, revision: currentRevision },
              ],
            },
          },
          {
            ...snapshot,
            pending: [pending],
            deliveries: [{ ...delivered, revision: currentRevision }],
          }
        )
      ).toEqual(rejected("unsupported_request"));
    }
  );
});

describe("argument revision preserves JSON meaning", () => {
  test("object key reordering does not change the binding", () => {
    const reordered = {
      ...request,
      action: {
        ...request.action,
        input: {
          attendees: ["invitee@example.com"],
          start: "2026-09-10T10:00:00-03:00",
        },
      },
    };
    expect(channelConsentRevision(reordered)).toBe(
      channelConsentRevision(request)
    );
  });
  test("target, call, prompt and option order changes invalidate the proposal", () => {
    const changes: InputRequest[] = [
      { ...request, action: { ...request.action, toolName: "gmail-send" } },
      { ...request, action: { ...request.action, callId: "other-call" } },
      { ...request, prompt: "enviar amanhã?" },
      { ...request, options: request.options?.toReversed() },
    ];
    for (const changed of changes)
      expect(channelConsentRevision(changed)).not.toBe(
        channelConsentRevision(request)
      );
  });
});

describe("unavailable source provenance and structural revision collisions", () => {
  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "source time %s is not verified provenance",
    (sourceOccurredAtMs) => {
      expect(
        validateChannelConsent(
          { ...source, sourceOccurredAtMs },
          interpretation,
          snapshot
        )
      ).toEqual(rejected("invalid_source"));
    }
  );
  test("array and numeric-key object are different proposal arguments", () => {
    const array = {
      ...request,
      action: { ...request.action, input: { value: ["x"] } },
    };
    const object = {
      ...request,
      action: { ...request.action, input: { value: { "0": "x" } } },
    };
    expect(channelConsentRevision(array)).not.toBe(
      channelConsentRevision(object)
    );
  });
  test("array order remains significant at nested argument positions", () => {
    const first = {
      ...request,
      action: { ...request.action, input: { nested: { values: ["a", "b"] } } },
    };
    const second = {
      ...request,
      action: { ...request.action, input: { nested: { values: ["b", "a"] } } },
    };
    expect(channelConsentRevision(first)).not.toBe(
      channelConsentRevision(second)
    );
  });
  test("the receipt identity must belong to the fully delivered chunk set", () => {
    expect(
      validateChannelConsent(source, interpretation, {
        ...snapshot,
        deliveries: [{ ...delivered, receiptId: "unrelated-receipt" }],
      })
    ).toEqual(rejected("missing_delivery"));
  });
});

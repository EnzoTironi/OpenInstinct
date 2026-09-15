import { Schema } from "effect";
import { childRoleContract } from "../../agent/lib/child-role";

export const sentinelVerdictSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("allow"),
  }),
  Schema.Struct({
    kind: Schema.Literal("ask"),
    reason: Schema.Literal("private_approval_required"),
  }),
  Schema.Struct({
    kind: Schema.Literal("deny"),
    reason: Schema.Literals([
      "child_cannot_send",
      "grant_injection",
      "read_only_contract",
      "reviewer_failed",
      "self_authorization",
      "unreviewed_stream",
      "wrong_audience",
    ]),
  }),
]);
export type SentinelVerdict = typeof sentinelVerdictSchema.Type;

const admissionSchema = Schema.Struct({
  actorUserId: Schema.String.check(Schema.isMinLength(1)),
  childRole: Schema.optionalKey(
    Schema.Literals(["advisor", "browser-agent", "builder", "researcher"])
  ),
  destinationUserId: Schema.String.check(Schema.isMinLength(1)),
  hasParent: Schema.Boolean,
  promptClaimsGrant: Schema.Boolean,
  reviewer: Schema.Literals(["error", "ok", "timeout"]),
  streamingUnreviewed: Schema.Boolean,
  workerSelfAuthorizes: Schema.Boolean,
});
export type SentinelAdmission = typeof admissionSchema.Type;

/**
 * Host/Executor intercept for audience crossing. This is not an Eve tool.
 * Fail closed: timeout, reviewer error, and unreviewed private tokens deny.
 */
export function reviewSentinel(encoded: Schema.Json): SentinelVerdict {
  const admission = Schema.decodeUnknownSync(admissionSchema, {
    onExcessProperty: "error",
  })(encoded);
  switch (admission.reviewer) {
    case "error":
    case "timeout":
      return { kind: "deny", reason: "reviewer_failed" };
    case "ok":
      break;
    default: {
      const exhaustive: never = admission.reviewer;
      return exhaustive;
    }
  }
  if (admission.streamingUnreviewed) {
    return { kind: "deny", reason: "unreviewed_stream" };
  }
  if (admission.promptClaimsGrant) {
    return { kind: "deny", reason: "grant_injection" };
  }
  if (admission.workerSelfAuthorizes) {
    return { kind: "deny", reason: "self_authorization" };
  }
  if (admission.hasParent) {
    return { kind: "deny", reason: "child_cannot_send" };
  }
  if (admission.childRole !== undefined) {
    const contract = childRoleContract(admission.childRole);
    if (!contract.writeEffects) {
      return { kind: "deny", reason: "read_only_contract" };
    }
  }
  if (admission.destinationUserId !== admission.actorUserId) {
    return { kind: "ask", reason: "private_approval_required" };
  }
  return { kind: "allow" };
}

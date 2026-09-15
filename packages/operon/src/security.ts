import { Schema } from "effect";

export const SubjectType = Schema.Literals(["user", "agent", "system"]);
export type SubjectType = typeof SubjectType.Type;

export const AgentAuthorizationTier = Schema.Literals([1, 2, 3, 4]);
export type AgentAuthorizationTier = typeof AgentAuthorizationTier.Type;

export const Subject = Schema.Struct({
  id: Schema.String,
  type: SubjectType,
  name: Schema.String,
  roles: Schema.Array(Schema.String),
  agentTier: Schema.optionalKey(AgentAuthorizationTier),
  tenantId: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type Subject = typeof Subject.Type;

export const DecisionVerdict = Schema.Literals([
  "allow",
  "review",
  "deny",
  "review_required",
  "evidence_insufficient",
]);
export type DecisionVerdict = typeof DecisionVerdict.Type;

export const SecurityContext = Schema.Struct({
  subject: Subject,
  correlationId: Schema.String,
  clientIp: Schema.optionalKey(Schema.String),
  timestamp: Schema.Number,
});
export type SecurityContext = typeof SecurityContext.Type;

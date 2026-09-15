import { Schema } from "effect";

export const subjectTypeSchema = Schema.Literals(["user", "agent", "system"]);
export type SubjectType = typeof subjectTypeSchema.Type;

export const agentAuthorizationTierSchema = Schema.Literals([1, 2, 3, 4]);
export type AgentAuthorizationTier = typeof agentAuthorizationTierSchema.Type;

export const subjectSchema = Schema.Struct({
  id: Schema.String,
  type: subjectTypeSchema,
  name: Schema.String,
  roles: Schema.Array(Schema.String),
  agentTier: Schema.optionalKey(agentAuthorizationTierSchema),
  tenantId: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type Subject = typeof subjectSchema.Type;

export const decisionVerdictSchema = Schema.Literals([
  "allow",
  "review",
  "deny",
  "review_required",
  "evidence_insufficient",
]);
export type DecisionVerdict = typeof decisionVerdictSchema.Type;

export const securityContextSchema = Schema.Struct({
  subject: subjectSchema,
  correlationId: Schema.String,
  clientIp: Schema.optionalKey(Schema.String),
  timestamp: Schema.Number,
});
export type SecurityContext = typeof securityContextSchema.Type;

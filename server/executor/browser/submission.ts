import { Schema } from "effect";

const requiredId = Schema.String.check(Schema.isMinLength(1));

const browserSubmissionSchema = Schema.Struct({
  operationId: requiredId,
  origin: requiredId,
  target: requiredId,
});

const parseOptions = { onExcessProperty: "error" } as const;

/**
 * Exact browser side-effect envelope. Kernel/provider dispatch is not a
 * second outbox; the host records the operation before any live submit.
 */
export function browserSubmissionEffect(encoded: Schema.Json) {
  const submission = Schema.decodeUnknownSync(
    browserSubmissionSchema,
    parseOptions
  )(encoded);
  return {
    effectKind: "browser_submit" as const,
    operationId: submission.operationId,
    origin: submission.origin,
    target: submission.target,
  };
}

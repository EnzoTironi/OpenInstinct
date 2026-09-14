import { expect, test } from "vitest";
import { Schema } from "effect";
import { ontologyActionInputSchema } from "./ontology";

const decode = Schema.toStandardSchemaV1(ontologyActionInputSchema)["~standard"]
  .validate;

const action = {
  entityId: "release_project",
  actionId: "project_status",
  value: "active",
  expectedRevision: "a".repeat(40),
};

test.each([
  "Approve this change? ",
  " Approve this change?",
  "Approve this change?\n",
])(
  "accepts harmless proposal whitespace while preserving exact arguments: %j",
  async (approvalMessage) => {
    expect(await decode({ ...action, approvalMessage })).toEqual({
      value: { ...action, approvalMessage },
    });
  }
);
test.each(["", " \n\t"])(
  "refuses blank proposals: %j",
  async (approvalMessage) => {
    expect(await decode({ ...action, approvalMessage })).toHaveProperty(
      "issues"
    );
  }
);

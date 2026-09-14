import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Predicate } from "effect";
import {
  artifactDelete,
  artifactList,
  artifactRead,
} from "../executor/tools/artifacts";
import { authorizeApprovalResponse } from "../../agent/lib/approval-response";

const validate = (
  tool: { readonly inputSchema: unknown },
  input: Record<string, string | number>
) => {
  const schema = tool.inputSchema;
  if (!(schema instanceof z.ZodType))
    throw new Error(
      "The actual artifact tool must expose its Standard Schema validator."
    );
  return schema["~standard"].validate(input);
};

describe("artifact tool authority boundary", () => {
  test("read accepts only a valid stable ID", async () => {
    const artifactId = randomUUID();
    expect(await validate(artifactRead, { artifactId })).toMatchObject({
      value: { artifactId },
    });
    expect(
      await validate(artifactRead, { artifactId: "not-an-id" })
    ).toHaveProperty("issues");
  });
  test.each([
    "identityId",
    "workspaceId",
    "senderId",
    "destination",
    "sourceInboxId",
  ])("rejects model-provided %s", async (field) => {
    expect(
      await validate(artifactRead, {
        artifactId: randomUUID(),
        [field]: "untrusted",
      })
    ).toHaveProperty("issues");
  });
  test("list remains bounded", async () => {
    expect(await validate(artifactList, { limit: 50 })).toHaveProperty("value");
    expect(await validate(artifactList, { limit: 51 })).toHaveProperty(
      "issues"
    );
    expect(
      await validate(artifactList, { limit: 1, identityId: randomUUID() })
    ).toHaveProperty("issues");
  });
  test("deletion requires the existing native approval gate and a complete authored proposal", async () => {
    const approval = artifactDelete.approval;
    if (!Predicate.isObject(approval))
      throw new Error("Missing approval policy");
    expect(Predicate.isFunction(approval.request)).toBe(true);
    expect(approval.response).toBe(authorizeApprovalResponse);
    const artifactId = randomUUID();
    expect(await validate(artifactDelete, { artifactId })).toHaveProperty(
      "issues"
    );
    expect(
      await validate(artifactDelete, { artifactId, approvalMessage: " " })
    ).toHaveProperty("issues");
    expect(
      await validate(artifactDelete, {
        artifactId,
        approvalMessage: "Excluir o arquivo salvo e o texto extraído?",
      })
    ).toHaveProperty("value");
  });
});

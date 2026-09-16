import { describe, expect, it } from "vitest";
import {
  activateSkill,
  bindProviderToolName,
  skillAuthoringTemplate,
  unbindProviderToolName,
} from "./skill-activation";

const testedSha256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const workingSha256 =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const template = {
  avoidWhen: ["sem destinatário autorizado"],
  branches: ["se faltar evidência, parar"],
  observedDone: "recibo do canal com o mesmo operationId",
  pointOfActionCautions: ["não enviar rascunho"],
  requiredCapabilities: ["channel_send"],
  testedSha256,
  triggers: ["follow-through diário"],
};

const load = {
  action: "load" as const,
  builderSelfAuthorizes: false,
  publishedSha256: testedSha256,
  template,
  workingSha256,
};

describe("skill activation", () => {
  it("does load instructions without install, publish, send, or working-tree bytes", () => {
    expect(activateSkill(load)).toEqual({
      kind: "instructions",
      revision: testedSha256,
    });
    expect(
      activateSkill({
        ...load,
        action: "execute",
      })
    ).toEqual({
      kind: "invoke_published",
      revision: testedSha256,
    });
    expect(activateSkill({ ...load, action: "install" })).toEqual({
      kind: "deny",
      reason: "side_effect",
    });
    expect(activateSkill({ ...load, action: "publish" })).toEqual({
      kind: "deny",
      reason: "side_effect",
    });
    expect(activateSkill({ ...load, action: "send" })).toEqual({
      kind: "deny",
      reason: "side_effect",
    });
    expect(activateSkill({ ...load, action: "deploy" })).toEqual({
      kind: "deny",
      reason: "side_effect",
    });
    expect(activateSkill({ ...load, action: "create" })).toEqual({
      kind: "draft",
    });
    expect(
      activateSkill({
        ...load,
        action: "create",
        existingCapability: "channel_send",
      })
    ).toEqual({ kind: "deny", reason: "use_existing" });
  });

  it("does block builder self-approval and read-only indirect execute", () => {
    expect(
      activateSkill({
        ...load,
        action: "execute",
        builderSelfAuthorizes: true,
      })
    ).toEqual({ kind: "deny", reason: "builder_self_approval" });
    expect(
      activateSkill({
        ...load,
        action: "execute",
        childRole: "researcher",
      })
    ).toEqual({ kind: "deny", reason: "read_only_contract" });
    expect(
      activateSkill({
        ...load,
        action: "load",
        childRole: "advisor",
      })
    ).toEqual({
      kind: "instructions",
      revision: testedSha256,
    });
    expect(() =>
      skillAuthoringTemplate({
        ...template,
        install: "pnpm add evil",
      })
    ).toThrow(/excess|Unexpected|extra/i);
  });

  it("does encode provider tool names deterministically and reversibly", () => {
    const names = [
      "vendor.mail.send",
      "vendor_mail_send",
      "a".repeat(180),
      "ção/espaço",
    ];
    const bound = names.map(bindProviderToolName);
    expect(new Set(bound).size).toBe(names.length);
    expect(names.map(bindProviderToolName)).toEqual(bound);
    expect(bound.map(unbindProviderToolName)).toEqual(names);
  });
});

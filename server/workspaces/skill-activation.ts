import { Schema } from "effect";
import { childRoleContract } from "../../agent/lib/child-role";

const parseOptions = { onExcessProperty: "error" } as const;
const requiredId = Schema.String.check(Schema.isMinLength(1));
const sha256Schema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
const requiredList = Schema.Array(requiredId).check(Schema.isMinLength(1));

const templateSchema = Schema.Struct({
  avoidWhen: requiredList,
  branches: requiredList,
  observedDone: requiredId,
  pointOfActionCautions: requiredList,
  requiredCapabilities: requiredList,
  testedSha256: sha256Schema,
  triggers: requiredList,
});

const activationSchema = Schema.Struct({
  action: Schema.Literals([
    "create",
    "deploy",
    "execute",
    "install",
    "load",
    "publish",
    "send",
  ]),
  builderSelfAuthorizes: Schema.Boolean,
  childRole: Schema.optionalKey(
    Schema.Literals(["advisor", "browser-agent", "builder", "researcher"])
  ),
  existingCapability: Schema.optionalKey(requiredId),
  publishedSha256: sha256Schema,
  template: templateSchema,
  workingSha256: sha256Schema,
});

/**
 * Host skill activation. Load returns instructions only. Install, publish,
 * execute-as-effect, send and deploy are denied. Working-tree bytes are not
 * the published revision. This is not remote MCP.
 */
export function activateSkill(encoded: Schema.Json) {
  const admission = Schema.decodeUnknownSync(
    activationSchema,
    parseOptions
  )(encoded);
  if (admission.builderSelfAuthorizes) {
    return deny("builder_self_approval");
  }
  if (admission.childRole !== undefined) {
    const contract = childRoleContract(admission.childRole);
    if (!contract.writeEffects) {
      switch (admission.action) {
        case "create":
        case "load":
          break;
        case "deploy":
        case "execute":
        case "install":
        case "publish":
        case "send":
          return deny("read_only_contract");
        default: {
          const exhaustive: never = admission.action;
          return exhaustive;
        }
      }
    }
  }
  switch (admission.action) {
    case "load":
      return {
        kind: "instructions" as const,
        revision: admission.publishedSha256,
      };
    case "create":
      if (admission.existingCapability !== undefined) {
        return deny("use_existing");
      }
      return { kind: "draft" as const };
    case "execute":
      return {
        kind: "invoke_published" as const,
        revision: admission.publishedSha256,
      };
    case "deploy":
    case "install":
    case "publish":
    case "send":
      return deny("side_effect");
    default: {
      const exhaustive: never = admission.action;
      return exhaustive;
    }
  }
}

export function skillAuthoringTemplate(encoded: Schema.Json) {
  return Schema.decodeUnknownSync(templateSchema, parseOptions)(encoded);
}

export function bindProviderToolName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new Error("Tool name is empty or too long.");
  }
  return `s_${Buffer.from(trimmed, "utf8").toString("base64url")}`;
}

export function unbindProviderToolName(bound: string) {
  if (!bound.startsWith("s_")) {
    throw new Error("Bound tool name is not a host encoding.");
  }
  return Buffer.from(bound.slice(2), "base64url").toString("utf8");
}

function deny(
  reason:
    | "builder_self_approval"
    | "read_only_contract"
    | "side_effect"
    | "use_existing"
) {
  return { kind: "deny" as const, reason };
}

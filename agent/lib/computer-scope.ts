import type { ConnectionPrincipal } from "eve/connections";
import type { SessionAuthContext } from "eve/context";
import { Schema } from "effect";
import {
  computerScopeKey,
  type ComputerScope,
} from "../../server/operon-kernel";
import {
  isSharedPrincipal,
  scopeFromPrincipal,
} from "../../shared/identity/principal-scope";

export class ComputerScopeError extends Schema.TaggedError<ComputerScopeError>()(
  "ComputerScopeError",
  { message: Schema.String }
) {}

const identifier = Schema.NonEmptyString.check(Schema.isTrimmed());
const sharedAttributesSchema = Schema.Struct({
  agentGrantId: Schema.optionalKey(identifier),
  chatKind: Schema.optionalKey(Schema.Literals(["private", "group"])),
  conversationId: Schema.optionalKey(identifier),
  conversationScope: Schema.optionalKey(identifier),
  groupBindingId: Schema.optionalKey(identifier),
  workspaceId: identifier,
});

function sharedAudienceId(
  attributes: typeof sharedAttributesSchema.Type
): string | undefined {
  if (attributes.groupBindingId) {
    return attributes.groupBindingId;
  }
  if (attributes.agentGrantId) {
    return attributes.agentGrantId;
  }
  if (attributes.conversationScope?.startsWith("group:")) {
    return attributes.conversationScope;
  }
  if (attributes.chatKind === "group" && attributes.conversationId) {
    return attributes.conversationId;
  }
  return undefined;
}

/**
 * Host-derived computer identity. Private work stays on the authenticated
 * user; shared work uses an explicit audience, never a workspace id alone.
 */
export function computerScopeFromPrincipal(
  input: SessionAuthContext | Extract<ConnectionPrincipal, { type: "user" }>
): ComputerScope {
  if (!isSharedPrincipal(input)) {
    return {
      kind: "private",
      ...scopeFromPrincipal(input),
    };
  }
  const attributes = Schema.decodeUnknownSync(sharedAttributesSchema, {
    onExcessProperty: "ignore",
  })(input.attributes ?? {});
  const audienceId = sharedAudienceId(attributes);
  if (!audienceId) {
    throw new ComputerScopeError({
      message:
        "O ambiente compartilhado exige um destinatário e um espaço explícitos.",
    });
  }
  return {
    kind: "shared",
    audienceId,
    workspaceId: attributes.workspaceId,
  };
}

export function computerSessionKey(
  input: SessionAuthContext | Extract<ConnectionPrincipal, { type: "user" }>
) {
  return computerScopeKey(computerScopeFromPrincipal(input));
}

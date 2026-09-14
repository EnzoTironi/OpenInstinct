import type { ConnectionPrincipal } from "eve/connections";
import type { SessionAuthContext } from "eve/context";
import { Result, Schema } from "effect";
import { accessScopeForUser } from "@shared/identity/access-scope";

const identifier = Schema.NonEmptyString.check(Schema.isTrimmed());
const decodePrincipal = Schema.decodeUnknownResult(
  Schema.Struct({
    attributes: Schema.Struct({
      workspaceId: identifier,
      workspaceKind: Schema.optionalKey(
        Schema.Literals(["personal", "company"])
      ),
    }),
    id: Schema.optionalKey(identifier),
    principalId: Schema.optionalKey(identifier),
  })
);

class PrincipalScopeError extends Schema.TaggedError<PrincipalScopeError>()(
  "PrincipalScopeError",
  { message: Schema.String }
) {}

export function scopeFromPrincipal(
  input: SessionAuthContext | Extract<ConnectionPrincipal, { type: "user" }>
) {
  if (
    ("authenticator" in input && input.authenticator === "a2a") ||
    input.attributes?.agentGrantId ||
    input.attributes?.groupBindingId ||
    input.attributes?.chatKind === "group" ||
    (Schema.is(Schema.String)(input.attributes?.conversationScope) &&
      input.attributes.conversationScope.startsWith("group:"))
  ) {
    throw new PrincipalScopeError({
      message:
        "Shared agent executions require an explicitly granted workspace tool.",
    });
  }
  const principal = Result.getOrThrowWith(
    decodePrincipal(input),
    () =>
      new PrincipalScopeError({
        message: "An authenticated workspace user is required.",
      })
  );
  const userId = principal.id ?? principal.principalId;
  if (
    !userId ||
    (principal.id &&
      principal.principalId &&
      principal.id !== principal.principalId)
  ) {
    throw new PrincipalScopeError({
      message: "An unambiguous authenticated workspace user is required.",
    });
  }
  const scope = accessScopeForUser(userId);
  // This marker is issued only by an authenticated route after live membership
  // validation. Resource services still recheck membership at execution time.
  if (
    principal.attributes.workspaceKind === "company" &&
    !principal.attributes.workspaceId.startsWith("personal:")
  ) {
    return { userId, workspaceId: principal.attributes.workspaceId };
  }
  if (scope.workspaceId !== principal.attributes.workspaceId) {
    throw new PrincipalScopeError({
      message: "The workspace does not belong to the authenticated user.",
    });
  }
  return scope;
}

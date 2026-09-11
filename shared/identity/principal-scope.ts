import { accessScopeForUser } from "@shared/identity/access-scope";
import { Result, Schema } from "effect";
import type { ConnectionPrincipal } from "eve/connections";
import type { SessionAuthContext } from "eve/context";

const identifier = Schema.NonEmptyString.check(Schema.isTrimmed());

const decodePrincipal = Schema.decodeUnknownResult(
  Schema.Struct({
    attributes: Schema.Struct({ workspaceId: identifier }),
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

  if (scope.workspaceId !== principal.attributes.workspaceId) {
    throw new PrincipalScopeError({
      message: "The workspace does not belong to the authenticated user.",
    });
  }

  return scope;
}

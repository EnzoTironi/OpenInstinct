import { authentication, AuthUnavailable } from "@db/services/auth";
import { Effect } from "effect";

export const readAuthSession = Effect.fn("readAuthSession")(function* (
  headers: Headers
) {
  const auth = yield* authentication;

  return yield* Effect.tryPromise({
    try: () => auth.api.getSession({ headers }),
    catch: () => new AuthUnavailable(),
  });
});

export function getAuthSession(headers: Headers) {
  return Effect.runPromise(readAuthSession(headers));
}

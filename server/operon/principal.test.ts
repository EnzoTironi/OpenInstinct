import { Effect, Predicate } from "effect";
import { expect, it } from "vitest";

import {
  encodeSessionToken,
  PrincipalError,
  PrincipalIssuer,
} from "./principal";

it("does parse a session token into a Principal", async () => {
  const principal = await Effect.runPromise(
    Effect.gen(function* () {
      const issuer = yield* PrincipalIssuer;
      return yield* issuer.fromSessionToken(
        encodeSessionToken({
          audience: "companion",
          grants: ["consumer"],
          orgId: "companion-cell",
          sessionId: "sess-1",
          userId: "user-ana",
        })
      );
    }).pipe(Effect.provide(PrincipalIssuer.parseableLayer))
  );
  expect(Predicate.isTagged(principal, "Principal")).toBe(true);
  expect(principal.userId).toBe("user-ana");
  expect(principal.grants).toEqual(["consumer"]);
});

it("does reject a token that is not a Principal", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const issuer = yield* PrincipalIssuer;
      return yield* issuer.fromSessionToken("not-a-token").pipe(Effect.flip);
    }).pipe(Effect.provide(PrincipalIssuer.parseableLayer))
  );
  expect(error).toEqual(new PrincipalError({ reason: "invalid_token" }));
});

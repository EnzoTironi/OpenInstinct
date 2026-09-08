import { Deferred, Effect, Ref } from "effect";
import { expect, test } from "vitest";
import { ChannelAuthPromptError } from "../channel-auth/prompts";
import { dispatchItem } from "./dispatch";

test("an expired item does not interrupt an already running sibling", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<undefined>();
      const completed = yield* Ref.make(false);
      const interrupted = yield* Ref.make(false);
      const healthy = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Effect.sleep("10 millis");
        yield* Ref.set(completed, true);
      }).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true)));
      const expired = Effect.gen(function* () {
        yield* Deferred.await(started);
        return yield* new ChannelAuthPromptError({ reason: "lease_lost" });
      });
      yield* Effect.all(
        [
          dispatchItem("expired-prompt", expired),
          dispatchItem("healthy-identity", healthy),
        ],
        { concurrency: 2 }
      );
      expect(yield* Ref.get(completed)).toBe(true);
      expect(yield* Ref.get(interrupted)).toBe(false);
    })
  ));

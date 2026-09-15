import { Effect, Layer } from "effect";
import { ErasureJournal } from "../../server/accounts/erasure-journal";

/** Independent storage survives the database restoration exercised by deletion tests. */
export const erasureJournalFixture = Layer.effect(
  ErasureJournal,
  Effect.sync(() => {
    const users = new Set<string>();
    return {
      append: (userId: string) =>
        Effect.sync(() => {
          users.add(userId);
        }),
      read: () => Effect.sync(() => [...users].map((userId) => ({ userId }))),
    };
  })
);

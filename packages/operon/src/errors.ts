import { Schema } from "effect";

export class ConcurrentModificationError extends Schema.TaggedError<ConcurrentModificationError>()(
  "ConcurrentModificationError",
  {
    objectId: Schema.String,
    expectedVersion: Schema.Number,
    actualVersion: Schema.Number,
  }
) {}

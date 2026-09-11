import type { UserProfile } from "@shared/user-profile/schema";
import { Schema } from "effect";

export const storedNoteSchema = Schema.Struct({
  content: Schema.String,
  version: Schema.String.check(Schema.isUUID()),
  updatedAt: Schema.String,
});

export interface PersonalMemorySnapshot {
  readonly scope: "stored-personal-memory";
  readonly generatedAt: string;
  readonly profile: UserProfile;
  readonly notes: {
    readonly status: "located" | "unresolved";
    readonly documents: readonly (typeof storedNoteSchema.Type)[];
  };
  readonly coverage: {
    readonly included: readonly ["structured-profile", "bound-profile-notes"];
    readonly excluded: readonly [
      "conversation-history",
      "artifacts",
      "connected-accounts",
      "schedules",
      "unbound-memory-documents",
    ];
  };
}

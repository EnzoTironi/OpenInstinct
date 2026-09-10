/**
 * Honest coverage for personal account privacy export / online wipe.
 * Shared by API responses and Account UI so we never claim full erasure.
 */

export const accountPrivacyExportExcluded = [
  "conversation-history",
  "artifacts",
  "connected-accounts",
  "schedules",
  "unbound-memory-documents",
  "channel-identities",
  "browser-sessions",
  "backups",
] as const;

export const accountOnlineWipeNotWiped = [
  "conversation-history",
  "artifacts",
  "connected-accounts",
  "schedules",
  "unbound-memory-documents",
  "channel-identities",
  "backups",
  "workspace-row",
  "user-row",
] as const;

export const accountPrivacyExportLimits =
  "Partial online export of stored personal memory only. Not a full-account backup or restore contract.";

export const accountOnlineWipeLimits =
  "Online personal-memory wipe and browser session invalidation only. Channel identities, schedules, artifacts, conversation history, backups and the user/workspace rows are not erased. Do not claim full account deletion or backup erasure.";

export const accountOnlineWipeWipedHint = [
  "personal-memory-profile",
  "bound-profile-notes",
  "browser-sessions",
] as const;

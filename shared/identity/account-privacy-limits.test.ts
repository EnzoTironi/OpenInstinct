import { describe, expect, it } from "vitest";
import {
  accountOnlineWipeLimits,
  accountOnlineWipeNotWiped,
  accountPrivacyExportExcluded,
} from "./account-privacy-limits";

describe("account privacy honesty constants", () => {
  it("never claims full account or backup erasure in wipe limits", () => {
    expect(accountOnlineWipeLimits.toLowerCase()).toContain("not");
    expect(accountOnlineWipeLimits.toLowerCase()).toContain("full account");
    expect(accountOnlineWipeNotWiped).toContain("backups");
    expect(accountOnlineWipeNotWiped).toContain("user-row");
    expect(accountOnlineWipeNotWiped).toContain("channel-identities");
  });

  it("keeps export exclusions aligned with wipe honesty", () => {
    expect(accountPrivacyExportExcluded).toContain("conversation-history");
    expect(accountPrivacyExportExcluded).toContain("backups");
  });
});

import { describe, expect, it } from "vitest";
import {
  companionCanonicalPath,
  companionPublicHost,
  companionPublicOrigin,
} from "../public-origin";

describe("marketing public origin", () => {
  it("canonicalizes only to companion.tironi.xyz", () => {
    expect(companionPublicHost).toBe("companion.tironi.xyz");
    expect(companionPublicOrigin).toBe("https://companion.tironi.xyz");
    expect(companionCanonicalPath("/welcome")).toBe(
      "https://companion.tironi.xyz/welcome"
    );
    expect(companionCanonicalPath("/pricing")).toBe(
      "https://companion.tironi.xyz/pricing"
    );
    expect(companionCanonicalPath("/docs")).toBe(
      "https://companion.tironi.xyz/docs"
    );
  });
});

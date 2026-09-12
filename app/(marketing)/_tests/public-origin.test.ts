import { describe, expect, it } from "vitest";
import {
  companionCanonicalPath,
  companionPublicHost,
  companionPublicOrigin,
} from "../public-origin";

describe("marketing public origin", () => {
  it("canonicalizes only to zoen.tironi.xyz", () => {
    expect(companionPublicHost).toBe("zoen.tironi.xyz");
    expect(companionPublicOrigin).toBe("https://zoen.tironi.xyz");
    expect(companionCanonicalPath("/welcome")).toBe(
      "https://zoen.tironi.xyz/welcome"
    );
    expect(companionCanonicalPath("/docs")).toBe(
      "https://zoen.tironi.xyz/docs"
    );
    expect(companionCanonicalPath("/docs")).toBe(
      "https://zoen.tironi.xyz/docs"
    );
  });
});

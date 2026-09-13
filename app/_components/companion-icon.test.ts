import { describe, expect, it } from "vitest";
import { companionIconImage } from "./companion-icon";

describe("companion icon", () => {
  it("redirects to the public favicon path without an application origin", () => {
    const response = companionIconImage();
    const location = response.headers.get("location");

    expect(response.status).toBe(307);
    expect(location).toBe("/marketing/zoen-favicon.png");
    expect(location).not.toContain("127.0.0.1");
    expect(location).not.toMatch(/^https?:\/\//);
  });
});

import { describe, expect, it } from "vitest";

import { currentTimeInstructions } from "../current-time";

describe("fresh turn clock instructions", () => {
  it("replaces the previous turn's reference, including across UTC midnight", () => {
    const earlier = new Date("2026-09-08T23:59:59.999Z");
    const later = new Date("2026-09-09T00:00:00.001Z");
    const previous = currentTimeInstructions(earlier);
    const current = currentTimeInstructions(later);
    expect(previous.content).toContain(earlier.toISOString());
    expect(current.content).toContain(later.toISOString());
    expect(current.content).not.toContain(earlier.toISOString());
    expect(current.role).toBe("system");
  });

  it("samples the server clock when invoked, rather than caching module-load time", () => {
    const before = Date.now();
    const instructions = currentTimeInstructions();
    const after = Date.now();

    const timestamp = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/u.exec(
      instructions.content
    )?.[0];

    expect(timestamp).toBeDefined();
    const observed = Date.parse(timestamp ?? "");
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });

  it("keeps the instant in UTC independently of the supplied local offset", () => {
    expect(
      currentTimeInstructions(new Date("2026-09-08T16:39:00-03:00")).content
    ).toContain("2026-09-08T19:39:00.000Z (UTC)");
  });
});

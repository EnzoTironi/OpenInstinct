import { describe, expect, it } from "vitest";
import { getLocalDay } from "./local-day";

describe("local day", () => {
  it.each([
    [0, 0, "midnight", "Boa noite."],
    [4, 59, "midnight", "Boa noite."],
    [5, 0, "predawn", "Bom dia."],
    [6, 0, "dawn", "Bom dia."],
    [8, 0, "day", "Bom dia."],
    [11, 59, "day", "Bom dia."],
    [12, 0, "day", "Boa tarde."],
    [15, 59, "day", "Boa tarde."],
    [16, 0, "sunset", "Boa tarde."],
    [18, 0, "dusk", "Boa noite."],
    [20, 0, "midnight", "Boa noite."],
    [23, 59, "midnight", "Boa noite."],
  ])("uses the local clock at %i:%i", (hour, minute, sky, greeting) => {
    expect(getLocalDay(new Date(2026, 8, 12, hour, minute))).toEqual({
      sky,
      greeting,
    });
  });

  it("renders a stable greeting until the browser clock is available", () => {
    expect(getLocalDay(undefined)).toEqual({
      sky: "midnight",
      greeting: "Um respiro no dia.",
    });
  });
});

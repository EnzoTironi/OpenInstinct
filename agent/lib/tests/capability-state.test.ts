import { describe, expect, it } from "vitest";
import { composeCapabilityStateInstructions } from "../capability-state";

describe("host capability state instructions", () => {
  it("does not promise Gmail when Google is disabled even if memory could mention it", () => {
    const content = composeCapabilityStateInstructions({
      channel: "eve",
      enabledPlugins: ["files", "memory"],
      googleAccountLabels: ["Remembered work Gmail"],
    });
    expect(content).toContain("Current channel: web chat.");
    expect(content).toContain("Enabled workspace plugins: files, memory.");
    expect(content).toContain("Google Workspace is not enabled");
    expect(content).toContain(
      "do not treat remembered connection text as live account state"
    );
    expect(content).not.toContain("Remembered work Gmail");
    expect(content).toContain(
      "It never rewrites grants, publication, egress, tool limits or host policy."
    );
    expect(content).toContain(
      "Ordinary plaintext is not a private side channel."
    );
    expect(content).toContain("There is no global two- or three-sentence cap.");
  });

  it("does not promise Gmail when the plugin is on but no account is connected", () => {
    const content = composeCapabilityStateInstructions({
      channel: "kapso",
      enabledPlugins: ["files", "memory", "google"],
      googleAccountLabels: ["  "],
    });
    expect(content).toContain("Current channel: WhatsApp.");
    expect(content).toContain("no Google account is connected");
    expect(content).not.toContain("connected this turn for");
  });

  it("lists only the live Google account labels", () => {
    const content = composeCapabilityStateInstructions({
      channel: "telegram",
      enabledPlugins: ["files", "google"],
      googleAccountLabels: ["Work", "Personal"],
    });
    expect(content).toContain("Current channel: Telegram.");
    expect(content).toContain(
      'Google Workspace is connected this turn for: "Work", "Personal".'
    );
    expect(content).toContain("Do not silently pick another account.");
  });

  it("names an unknown channel as the current authenticated channel", () => {
    expect(
      composeCapabilityStateInstructions({
        channel: undefined,
        enabledPlugins: ["files"],
        googleAccountLabels: [],
      })
    ).toContain("Current channel: the current authenticated channel.");
  });
});

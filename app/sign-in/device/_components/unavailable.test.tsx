import { createElement } from "react";
import { renderToEnglishMarkup as renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import { DeviceChallengeRecovery } from "@web/auth/channel/device";
import { DeviceSignInUnavailable } from "./unavailable";

describe("device sign-in recovery", () => {
  it("offers sign-in and get-started when the link has no valid params", () => {
    const html = renderToStaticMarkup(createElement(DeviceSignInUnavailable));
    expect(html).toContain("This sign-in link is not valid");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Sign in");
    expect(html).toContain('href="/get-started"');
    expect(html).toContain("Get started");
    expect(html).not.toContain("This page could not be found");
  });

  it("offers start-again from an orphan or unverified challenge", () => {
    const html = renderToStaticMarkup(
      createElement(DeviceChallengeRecovery, {
        message:
          "This sign-in could not be verified in this browser. Start again and confirm the new request in chat.",
        purpose: "login",
        showSignInAgain: false,
      })
    );
    expect(html).toContain("could not be verified");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Start again");
  });
});

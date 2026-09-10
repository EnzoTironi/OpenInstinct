import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GetStartedPanel } from "../_components/get-started-panel";

describe("consumer get-started", () => {
  it("shows the signup → channel bind path without self-host language", () => {
    const html = renderToStaticMarkup(
      createElement(GetStartedPanel, { callbackUrl: "/?welcome=1" })
    );
    expect(html).toContain("Get started in one flow");
    expect(html).toContain("Connect your first channel");
    expect(html).toContain("Continue with Telegram");
    expect(html).toContain("Continue with WhatsApp");
    expect(html).toContain("No self-hosting required");
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain("Docker");
    expect(html).not.toContain("fly.toml");
    expect(html).not.toContain("Alchemy");
  });
});

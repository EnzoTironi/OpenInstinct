import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeOverview } from "../_components/home-overview";

describe("Companion home", () => {
  it("renders conversation first with channel status and plan entry", () => {
    const html = renderToStaticMarkup(
      createElement(HomeOverview, {
        identities: [{ channel: "telegram", senderId: "42" }],
      })
    );
    expect(html).toContain('href="/chat"');
    expect(html).toContain("Start a conversation");
    expect(html).toContain("Your setup");
    expect(html).toContain("Telegram");
    expect(html).toContain("Linked");
    expect(html).toContain("Free · Personal");
    expect(html).toContain('href="/account#plan"');
    expect(html).toContain("Next steps");
    expect(html).toContain('href="/personal-info"');
    expect(html).toContain('href="/chat/history"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain("Browser activity");
    expect(html).toContain('href="/vault"');
    expect(html.indexOf("Start a conversation")).toBeLessThan(
      html.indexOf("Browser tools")
    );
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain("iMessage");
  });

  it("shows messenger empty state when nothing is linked", () => {
    const html = renderToStaticMarkup(createElement(HomeOverview));
    expect(html).toContain("Needed");
    expect(html).toContain("Link a messenger");
    expect(html).toContain("No messenger linked yet.");
    expect(html).toContain('href="/account"');
  });
});

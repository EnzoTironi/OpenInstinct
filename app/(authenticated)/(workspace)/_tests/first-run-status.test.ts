import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FirstRunStatus,
  describeLinkedChannels,
} from "../_components/first-run-status";

describe("first-run status", () => {
  it("describes linked messenger families", () => {
    expect(
      describeLinkedChannels([{ channel: "telegram", senderId: "1" }])
    ).toContain("Telegram");
    expect(
      describeLinkedChannels([
        { channel: "telegram", senderId: "1" },
        { channel: "kapso", senderId: "2" },
      ])
    ).toContain("WhatsApp");
  });

  it("shows success after welcome when a channel is linked", () => {
    const html = renderToStaticMarkup(
      createElement(FirstRunStatus, {
        welcome: true,
        identities: [{ channel: "telegram", senderId: "42" }],
      })
    );
    expect(html).toContain("Tudo pronto.");
    expect(html).toContain("Telegram está conectado");
    expect(html).toContain('href="/chat"');
    expect(html).toContain('href="/connections?messengers=1"');
  });

  it("prompts to link a channel when welcome arrives without identities", () => {
    const html = renderToStaticMarkup(
      createElement(FirstRunStatus, { welcome: true, identities: [] })
    );
    expect(html).toContain("Leve o Zoen com você.");
    expect(html).toContain('href="/connections?messengers=1"');
  });

  it("stays quiet for ordinary visits when channels already exist", () => {
    const html = renderToStaticMarkup(
      createElement(FirstRunStatus, {
        welcome: false,
        identities: [{ channel: "kapso", senderId: "9" }],
      })
    );
    expect(html).toBe("");
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { ConnectionList } from "./connection-list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn<() => void>() }),
}));
vi.mock("@web/trpc/client", () => ({
  api: {
    googleWorkspace: {
      update: {
        useMutation: () => ({ isPending: false, mutate: vi.fn<() => void>() }),
      },
    },
    accountChannels: {
      revoke: {
        useMutation: () => ({ isPending: false, mutate: vi.fn<() => void>() }),
      },
    },
  },
}));

describe("connection directory", () => {
  it("places linked services before available services without offering to link them twice", () => {
    const markup = renderToStaticMarkup(
      <ConnectionList
        googleState="connected"
        identities={[{ id: "linked", channel: "telegram", senderId: "42" }]}
        returnTo="/"
      />,
      "en"
    );
    expect(markup.indexOf("Connected")).toBeLessThan(
      markup.indexOf("Add a connection")
    );
    expect(markup.match(/>Telegram</g)).toHaveLength(1);
    expect(markup.match(/>WhatsApp</g)).toHaveLength(1);
    expect(markup).toContain("Gmail, Calendar &amp; Contacts");
    expect(markup).not.toContain("Disconnect and sign out");
  });
  it("keeps an unconfigured Google connection disabled and offers supported messengers", () => {
    const markup = renderToStaticMarkup(
      <ConnectionList googleState="unavailable" identities={[]} returnTo="/" />,
      "es"
    );
    expect(markup).toContain("Tus conexiones aparecerán aquí.");
    expect(markup).toContain("En preparación");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Telegram");
    expect(markup).toContain("WhatsApp");
    expect(markup).not.toContain("Shopify");
    expect(markup).not.toContain("Notion");
  });
});

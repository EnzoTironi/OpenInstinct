import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import { OnboardingProvider } from "../../_components/onboarding";
import { MarketingLanding } from "../_components/marketing-landing";

describe("marketing landing", () => {
  it("uses the production host and conversion paths", () => {
    const html = renderToStaticMarkup(
      <OnboardingProvider
        destinations={{
          whatsapp: "https://wa.me/15551234567",
          telegram: "https://t.me/companion_test_bot",
          imessage: "sms:+15557654321",
        }}
      >
        <MarketingLanding />
      </OnboardingProvider>
    );
    expect(html).toContain("zoen.tironi.xyz");
    expect(html).toContain("https://zoen.tironi.xyz");
    expect(html).not.toContain("zoen.space");
    expect(html).not.toContain("poke.com");
    expect(html).not.toContain("Ver todos os planos");
    expect(html).toContain("Começar agora");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('href="/get-started"');
    expect(html).not.toContain('href="/pricing"');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="https://wa.me/15551234567"');
    expect(html).toContain('href="https://t.me/companion_test_bot"');
    expect(html).toContain('href="sms:+15557654321"');
    expect(html).not.toContain('target="_blank"');
  });
});

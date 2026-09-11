import { Button } from "@web/components/ui/button";
import Link from "next/link";

import { MarketingShell } from "../../_components/marketing-shell";

const steps = [
  {
    title: "Open Get started",
    body: "Visit /get-started on the hosted Companion site.",
  },
  {
    title: "Choose Telegram or WhatsApp",
    body: "That messenger creates your account and personal workspace.",
  },
  {
    title: "Confirm in chat",
    body: "Approve the browser request in that messenger, then return to the tab.",
  },
  {
    title: "Land on home",
    body: "You see channel status, next steps, and your Free personal plan badge.",
  },
  {
    title: "Message Companion",
    body: "Chat in the linked messenger or start a web conversation. Manage channels and plan under Account.",
  },
] as const;

const links = [
  {
    href: "/get-started",
    title: "Get started",
    body: "Create your account and bind a channel in one flow.",
  },
  {
    href: "/pricing",
    title: "Pricing",
    body: "Free, Pro, and Org seats — Free never requires a card.",
  },
  {
    href: "/sign-in",
    title: "Sign in",
    body: "Returning users sign in with an already linked messenger.",
  },
] as const;

export function DocsPanel() {
  return (
    <MarketingShell active="docs">
      <main className="mx-auto w-full max-w-3xl space-y-12 px-4 py-12 sm:px-6 sm:py-16">
        <header className="space-y-3">
          <p className="type-caption text-muted-foreground">Docs</p>
          <h1 className="type-page-title">Consumer first-run</h1>
          <p className="type-supporting-body text-muted-foreground">
            Short path for a person using hosted Companion — not an operator
            self-host guide. Conversation-first native entry still works by
            messaging Telegram or WhatsApp with no web step.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button nativeButton={false} render={<Link href="/get-started" />}>
              Start now
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/welcome" />}
              variant="outline"
            >
              Back to product
            </Button>
          </div>
        </header>

        <section aria-labelledby="flow-heading" className="space-y-4">
          <h2 className="type-section-title" id="flow-heading">
            Flow
          </h2>
          <ol className="space-y-4">
            {steps.map((step, index) => (
              <li className="flex gap-3" key={step.title}>
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border type-label"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="type-label">{step.title}</p>
                  <p className="type-caption text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="trust-docs-heading" className="space-y-3">
          <h2 className="type-section-title" id="trust-docs-heading">
            Trust notes
          </h2>
          <ul className="type-supporting-body list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              Free never requires a card. Paid uses Stripe Checkout + Portal.
            </li>
            <li>
              Privacy export/wipe today covers personal memory only — not full
              account, history, backups, or channel-identity erasure.
            </li>
            <li>
              Do not expect WhatsApp proactive templates until Meta UTILITY
              approval lands.
            </li>
          </ul>
        </section>

        <section aria-labelledby="related-heading" className="space-y-4">
          <h2 className="type-section-title" id="related-heading">
            Related
          </h2>
          <ul className="grid gap-3">
            {links.map((item) => (
              <li key={item.href}>
                <Link
                  className="block rounded-xl border border-border/60 p-4 transition-colors hover:bg-muted/40"
                  href={item.href}
                >
                  <p className="type-label">{item.title}</p>
                  <p className="mt-1 type-caption text-muted-foreground">
                    {item.body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </MarketingShell>
  );
}

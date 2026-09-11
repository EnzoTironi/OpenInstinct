import { billingPlanCatalog } from "@shared/billing/plans";
import { Button } from "@web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card";
import {
  Building2Icon,
  LockIcon,
  MessageCircleIcon,
  SparklesIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";

import { MarketingShell } from "../../_components/marketing-shell";

const audiences = [
  {
    title: "People",
    body: "A personal Companion in Telegram or WhatsApp — no new app to learn.",
    icon: UserIcon,
  },
  {
    title: "Prosumers",
    body: "Higher limits when Companion becomes part of your daily work rhythm.",
    icon: SparklesIcon,
  },
  {
    title: "Orgs",
    body: "Seat-based Companion for teams with shared workspaces and admin billing.",
    icon: Building2Icon,
  },
] as const;

const steps = [
  {
    title: "Start free",
    body: "Open Get started. No card. Create your account in one browser flow.",
  },
  {
    title: "Bind a channel",
    body: "Confirm in Telegram or WhatsApp. That messenger becomes your front door.",
  },
  {
    title: "First useful reply",
    body: "Ask something real. Companion answers in chat — usually within minutes.",
  },
] as const;

const trust = [
  {
    title: "Free never needs a card",
    body: "Paid upgrades use Stripe Checkout. Manage or cancel in Customer Portal.",
    icon: LockIcon,
  },
  {
    title: "You approve sensitive actions",
    body: "Companion asks before it sends or changes things that need your say.",
    icon: MessageCircleIcon,
  },
  {
    title: "Honest privacy limits",
    body: "Export and wipe cover personal memory today — not full history erasure yet.",
    icon: UsersIcon,
  },
] as const;

const planOrder = [
  billingPlanCatalog.free,
  billingPlanCatalog.pro,
  billingPlanCatalog.org,
] as const;

function priceLabel(planId: "free" | "pro" | "org", amount: number) {
  if (planId === "free") return "$0";

  if (planId === "org") return `$${String(amount)}/seat`;

  return `$${String(amount)}`;
}

export function MarketingLanding() {
  return (
    <MarketingShell active="product">
      <main>
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl space-y-5 text-center">
            <p className="type-caption text-muted-foreground">
              Companion by Instinct
            </p>
            <h1 className="type-page-title text-balance sm:text-5xl sm:leading-tight">
              Meet Companion — your assistant in the chats you already use
            </h1>
            <p className="type-supporting-body mx-auto max-w-2xl text-muted-foreground">
              Works where you already message. Learns how you work, then gets to
              work — for people, prosumers, and orgs. Start free, step up when
              you need more headroom.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button
                nativeButton={false}
                render={<Link href="/get-started" />}
                size="lg"
              >
                Get started free
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/pricing" />}
                size="lg"
                variant="outline"
              >
                See pricing
              </Button>
            </div>
            <p className="type-caption text-muted-foreground">
              Telegram · WhatsApp · No install required on Free
            </p>
          </div>
        </section>

        <section
          aria-labelledby="audience-heading"
          className="border-y border-border/60 bg-muted/20"
        >
          <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-12 sm:grid-cols-3 sm:px-6">
            <h2 className="sr-only" id="audience-heading">
              Built for people, prosumers, and orgs
            </h2>
            {audiences.map((item) => (
              <Card
                className="border-border/60 bg-background/80"
                key={item.title}
              >
                <CardHeader className="space-y-3">
                  <item.icon
                    aria-hidden="true"
                    className="size-5 text-primary"
                  />
                  <CardTitle className="type-section-title">
                    {item.title}
                  </CardTitle>
                  <CardDescription className="type-supporting-body">
                    {item.body}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="how-heading"
          className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6"
        >
          <div className="mb-8 max-w-2xl space-y-2">
            <h2 className="type-section-title" id="how-heading">
              How it works
            </h2>
            <p className="type-supporting-body text-muted-foreground">
              Signup → bind WhatsApp or Telegram → first useful reply. Built for
              the hosted Companion path, not an ops install guide.
            </p>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li
                className="rounded-xl border border-border/60 p-5"
                key={step.title}
              >
                <p className="mb-3 type-caption text-muted-foreground">
                  Step {index + 1}
                </p>
                <p className="type-label">{step.title}</p>
                <p className="mt-2 type-caption text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <Button
              nativeButton={false}
              render={<Link href="/docs" />}
              variant="outline"
            >
              Read first-run docs
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="trust-heading"
          className="border-y border-border/60 bg-muted/20"
        >
          <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
            <div className="mb-8 max-w-2xl space-y-2">
              <h2 className="type-section-title" id="trust-heading">
                Trust, without overclaiming
              </h2>
              <p className="type-supporting-body text-muted-foreground">
                Privacy and billing promises match what Account can do today.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {trust.map((item) => (
                <div
                  className="rounded-xl border border-border/60 bg-background/80 p-5"
                  key={item.title}
                >
                  <item.icon
                    aria-hidden="true"
                    className="mb-3 size-5 text-primary"
                  />
                  <p className="type-label">{item.title}</p>
                  <p className="mt-2 type-caption text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="pricing-teaser-heading"
          className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6"
        >
          <div className="mb-8 space-y-2 text-center">
            <h2 className="type-section-title" id="pricing-teaser-heading">
              Start free, then step up
            </h2>
            <p className="type-supporting-body mx-auto max-w-2xl text-muted-foreground">
              Every plan gets Companion. Free never requires a card. Pro raises
              personal quotas. Org sells seats for teams.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {planOrder.map((plan) => (
              <Card key={plan.id}>
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>{plan.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="type-section-title">
                    {priceLabel(plan.id, plan.placeholderPriceUsdMonthly)}
                    {plan.id !== "free" ? (
                      <span className="type-caption text-muted-foreground">
                        {" "}
                        / mo
                      </span>
                    ) : null}
                  </p>
                  <ul className="space-y-2">
                    {plan.features.slice(0, 3).map((feature) => (
                      <li
                        className="type-caption text-muted-foreground"
                        key={feature}
                      >
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button nativeButton={false} render={<Link href="/get-started" />}>
              Start free
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/pricing" />}
              variant="outline"
            >
              Full pricing
            </Button>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}

import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import {
  ArrowUpRightIcon,
  ClockIcon,
  CreditCardIcon,
  HistoryIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";

import {
  describeLinkedChannels,
  type LinkedChannelSummary,
} from "./first-run-status";

const destinations = [
  {
    href: "/reminders",
    title: "Reminders",
    description: "See what’s scheduled and change it from a conversation.",
    icon: ClockIcon,
  },
  {
    href: "/personal-info",
    title: "Personal info",
    description: "Details Companion can use when filling in forms for you.",
    icon: UserRoundIcon,
  },
  {
    href: "/chat/history",
    title: "Conversation history",
    description: "Pick up an earlier chat where you left off.",
    icon: HistoryIcon,
  },
  {
    href: "/account",
    title: "Account and channels",
    description: "Messengers, plan, and personal workspace settings.",
    icon: UserRoundIcon,
  },
] as const;

function linkedLabels(identities: readonly LinkedChannelSummary[]) {
  const labels: string[] = [];

  for (const identity of identities) {
    const label = identity.channel === "telegram" ? "Telegram" : "WhatsApp";

    if (!labels.includes(label)) labels.push(label);
  }

  return labels;
}

const EMPTY_IDENTITIES: readonly LinkedChannelSummary[] = [];

export interface HomeOverviewProps {
  readonly identities?: readonly LinkedChannelSummary[];
  readonly planName?: string;
}

function supportingCopy(linked: boolean, labels: readonly string[]) {
  if (linked) {
    return `, or message Companion in ${labels.join(" or ")}.`;
  }

  return ", or link Telegram or WhatsApp so Companion can reach you there.";
}

function LinkMessengerButton({ linked }: { readonly linked: boolean }) {
  if (linked) return null;

  return (
    <Button
      nativeButton={false}
      render={<Link href="/account" />}
      size="lg"
      variant="outline"
    >
      <MessagesSquareIcon />
      Link a messenger
    </Button>
  );
}

function ChannelsDetail({
  linked,
  labels,
}: {
  readonly linked: boolean;
  readonly labels: readonly string[];
}) {
  if (linked) {
    return (
      <ul className="space-y-1 type-caption text-muted-foreground">
        {labels.map((label) => (
          <li key={label}>{label} can reach this account</li>
        ))}
      </ul>
    );
  }

  return (
    <p className="type-caption text-muted-foreground">
      Link Telegram or WhatsApp to finish setup and sign in from that chat.
    </p>
  );
}

function channelBadgeVariant(linked: boolean) {
  if (linked) return "success" as const;

  return "warning" as const;
}

function channelBadgeLabel(linked: boolean) {
  if (linked) return "Linked";

  return "Needed";
}

function manageChannelsLabel(linked: boolean) {
  if (linked) return "Manage channels";

  return "Link a channel";
}

function messengerNextTitle(linked: boolean) {
  if (linked) return "Add another messenger";

  return "Connect Telegram or WhatsApp";
}

function messengerNextDescription(linked: boolean) {
  if (linked) {
    return "Keep personal and work chats on separate linked channels.";
  }

  return "One confirmation in chat binds the channel to this account.";
}

function HomeHeader({
  linked,
  labels,
  planName,
}: {
  readonly linked: boolean;
  readonly labels: readonly string[];
  readonly planName: string;
}) {
  return (
    <header className="space-y-5 border-b border-border/50 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <p className="type-label text-muted-foreground">Home</p>
        <Badge render={<Link href="/account#plan" />} variant="outline">
          {planName} · Personal
        </Badge>
      </div>
      <div className="max-w-2xl space-y-3">
        <h1 className="type-page-title">What would you like help with?</h1>
        <p className="type-supporting-body text-muted-foreground">
          Ask a question, work through an idea, or hand off something you need
          done. Start here on the web
          {supportingCopy(linked, labels)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button nativeButton={false} render={<Link href="/chat" />} size="lg">
          <MessageSquareIcon />
          Start a conversation
        </Button>
        <LinkMessengerButton linked={linked} />
      </div>
    </header>
  );
}

function ChannelsCard({
  channelSummary,
  linked,
  labels,
}: {
  readonly channelSummary: string;
  readonly linked: boolean;
  readonly labels: readonly string[];
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="type-label">Channels</p>
          <p className="type-caption text-muted-foreground">{channelSummary}</p>
        </div>
        <Badge variant={channelBadgeVariant(linked)}>
          {channelBadgeLabel(linked)}
        </Badge>
      </div>
      <ChannelsDetail labels={labels} linked={linked} />
      <Button
        className="w-full sm:w-auto"
        nativeButton={false}
        render={<Link href="/account" />}
        size="sm"
        variant="outline"
      >
        {manageChannelsLabel(linked)}
      </Button>
    </div>
  );
}

function PlanCard({ planName }: { readonly planName: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-border/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="type-label">Plan</p>
          <p className="type-caption text-muted-foreground">
            Personal workspace · {planName}. No card required on Free.
          </p>
        </div>
        <Badge variant="secondary">{planName}</Badge>
      </div>
      <p className="type-caption text-muted-foreground">
        This is your personal Companion account. Org seats for teams are a
        separate plan when you need shared workspaces.
      </p>
      <Button
        className="w-full sm:w-auto"
        nativeButton={false}
        render={<Link href="/account#plan" />}
        size="sm"
        variant="outline"
      >
        <CreditCardIcon />
        Plan and billing
      </Button>
    </div>
  );
}

function SetupSection({
  channelSummary,
  linked,
  labels,
  planName,
}: {
  readonly channelSummary: string;
  readonly linked: boolean;
  readonly labels: readonly string[];
  readonly planName: string;
}) {
  return (
    <section aria-labelledby="status-heading" className="space-y-4">
      <h2 className="type-section-title" id="status-heading">
        Your setup
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChannelsCard
          channelSummary={channelSummary}
          labels={labels}
          linked={linked}
        />
        <PlanCard planName={planName} />
      </div>
    </section>
  );
}

function NextStepsSection({ linked }: { readonly linked: boolean }) {
  return (
    <section aria-labelledby="next-actions-heading" className="space-y-4">
      <h2 className="type-section-title" id="next-actions-heading">
        Next steps
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          nativeButton={false}
          render={<Link href="/chat" />}
          variant="surface"
        >
          <MessageSquareIcon aria-hidden="true" />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block type-label">Chat on the web</span>
            <span className="block type-caption text-muted-foreground">
              Open a conversation without leaving this tab.
            </span>
          </span>
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
        <Button
          nativeButton={false}
          render={<Link href="/account" />}
          variant="surface"
        >
          <MessagesSquareIcon aria-hidden="true" />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block type-label">
              {messengerNextTitle(linked)}
            </span>
            <span className="block type-caption text-muted-foreground">
              {messengerNextDescription(linked)}
            </span>
          </span>
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

function KeepTrackSection() {
  return (
    <section aria-labelledby="your-companion-heading" className="space-y-4">
      <h2 className="type-section-title" id="your-companion-heading">
        Keep track
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {destinations.map(({ href, title, description, icon: Icon }) => (
          <Button
            key={href}
            nativeButton={false}
            render={<Link href={href} />}
            variant="surface"
          >
            <Icon aria-hidden="true" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block type-label">{title}</span>
              <span className="block type-caption text-muted-foreground">
                {description}
              </span>
            </span>
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        ))}
      </div>
      <p className="type-supporting-body text-muted-foreground">
        Want Companion to remember a preference or forget something you shared?{" "}
        <Link
          className="text-foreground underline underline-offset-4"
          href="/chat?starter=memory"
        >
          Review or change memories in chat.
        </Link>
      </p>
    </section>
  );
}

function BrowserToolsSection() {
  return (
    <section aria-labelledby="browser-tools-heading" className="space-y-2">
      <h2
        className="type-label text-muted-foreground"
        id="browser-tools-heading"
      >
        Browser tools
      </h2>
      <div className="type-supporting-body flex flex-wrap gap-x-6 gap-y-2">
        <Link className="underline underline-offset-4" href="/tasks">
          Browser activity
        </Link>
        <Link className="underline underline-offset-4" href="/vault">
          Vault
        </Link>
      </div>
      <p className="type-caption text-muted-foreground">
        Review past browser work and manage saved credentials.
      </p>
    </section>
  );
}

export function HomeOverview({
  identities = EMPTY_IDENTITIES,
  planName = "Free",
}: HomeOverviewProps) {
  const linked = identities.length > 0;
  const labels = linkedLabels(identities);
  const channelSummary = describeLinkedChannels(identities);

  return (
    <>
      <HomeHeader labels={labels} linked={linked} planName={planName} />
      <SetupSection
        channelSummary={channelSummary}
        labels={labels}
        linked={linked}
        planName={planName}
      />
      <NextStepsSection linked={linked} />
      <KeepTrackSection />
      <BrowserToolsSection />
    </>
  );
}

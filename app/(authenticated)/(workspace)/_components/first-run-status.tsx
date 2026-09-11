import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import Link from "next/link";

export interface LinkedChannelSummary {
  readonly channel: "telegram" | "kapso";
  readonly senderId: string;
}

function channelLabel(channel: LinkedChannelSummary["channel"]) {
  return channel === "telegram" ? "Telegram" : "WhatsApp";
}

export function describeLinkedChannels(
  identities: readonly LinkedChannelSummary[]
) {
  if (identities.length === 0) return "No messenger linked yet.";
  const labels: string[] = [];

  for (const identity of identities) {
    const label = channelLabel(identity.channel);

    if (!labels.includes(label)) labels.push(label);
  }

  const first = labels.at(0);

  if (first !== undefined && labels.length === 1) {
    return first + " is linked to your account.";
  }

  return labels.join(" and ") + " are linked to your account.";
}

export function FirstRunStatus({
  identities,
  welcome,
}: {
  readonly identities: readonly LinkedChannelSummary[];
  readonly welcome: boolean;
}) {
  const linked = identities.length > 0;

  if (!welcome && linked) return null;

  if (linked) {
    return (
      <Alert>
        <AlertTitle>You&apos;re set up</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {describeLinkedChannels(identities)} Message Companion there, or
            start on the web. Manage messengers anytime from Account.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              nativeButton={false}
              render={<Link href="/chat" />}
              size="sm"
            >
              Start a conversation
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/account" />}
              size="sm"
              variant="outline"
            >
              Account and channels
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertTitle>Connect a messenger to finish setup</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Link Telegram or WhatsApp so Companion can reach you where you already
          chat. Your personal workspace is ready — this last step binds a
          messenger.
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/account" />}
          size="sm"
        >
          Link a channel
        </Button>
      </AlertDescription>
    </Alert>
  );
}

import {
  ArrowUpRightIcon,
  HistoryIcon,
  MessageSquareIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@web/components/ui/button";

export function HomeOverview() {
  return (
    <>
      <header className="space-y-5 border-b border-border/50 pb-8">
        <p className="type-label text-muted-foreground">Your Companion</p>
        <div className="max-w-2xl space-y-3">
          <h1 className="type-page-title">What would you like help with?</h1>
          <p className="type-supporting-body text-muted-foreground">
            Bring a question, work through an idea, or ask for help with
            something you need to do. Start with a conversation.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/chat" />} size="lg">
          <MessageSquareIcon />
          Start a conversation
        </Button>
        <p className="max-w-xl type-caption text-muted-foreground">
          Chat here on the web, or continue through Telegram or WhatsApp when
          messaging is set up for your account.
        </p>
      </header>

      <section aria-labelledby="your-companion-heading" className="space-y-4">
        <h2 className="type-section-title" id="your-companion-heading">
          Make it personal
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            nativeButton={false}
            render={<Link href="/personal-info" />}
            variant="surface"
          >
            <UserRoundIcon aria-hidden="true" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block type-label">Personal info</span>
              <span className="block type-caption text-muted-foreground">
                Review the details Companion can use when filling in forms.
              </span>
            </span>
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/chat/history" />}
            variant="surface"
          >
            <HistoryIcon aria-hidden="true" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block type-label">Conversation history</span>
              <span className="block type-caption text-muted-foreground">
                Return to an earlier conversation and pick up where you left
                off.
              </span>
            </span>
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        </div>
        <p className="type-supporting-body text-muted-foreground">
          Want Companion to remember a preference or forget something you
          shared?{" "}
          <Link
            className="text-foreground underline underline-offset-4"
            href="/chat?starter=memory"
          >
            Review or change memories in chat.
          </Link>
        </p>
      </section>

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
    </>
  );
}

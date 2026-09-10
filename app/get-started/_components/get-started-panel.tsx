import Link from "next/link";
import { ChannelAuthForm } from "@web/auth/channel/form";

const steps = [
  {
    title: "Connect a messenger",
    body: "Choose Telegram or WhatsApp. That creates your Companion account and personal workspace.",
  },
  {
    title: "Confirm in chat",
    body: "Open the chat, approve the browser request you started, then return to this tab.",
  },
  {
    title: "You’re ready",
    body: "Message the assistant in that chat, or continue here on the web. No self-hosting required.",
  },
] as const;

export function GetStartedPanel({
  callbackUrl,
}: {
  readonly callbackUrl: string;
}) {
  return (
    <section className="w-full max-w-md space-y-8">
      <header className="space-y-2">
        <p className="type-caption text-muted-foreground">Companion</p>
        <h1 className="type-page-title">Get started in one flow</h1>
        <p className="type-supporting-body text-muted-foreground">
          Create your personal account, land in your workspace, and bind
          Telegram or WhatsApp — no install, no card on Free.
        </p>
      </header>

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
              <p className="type-caption text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="space-y-3 rounded-xl border p-4 sm:p-5">
        <h2 className="type-section-title">Connect your first channel</h2>
        <ChannelAuthForm purpose="login" callbackUrl={callbackUrl} />
      </div>

      <p className="type-caption text-muted-foreground">
        Already set up?{" "}
        <Link className="underline underline-offset-4" href="/sign-in">
          Sign in
        </Link>{" "}
        with a linked messenger. After signup, home shows your channels and
        plan.
      </p>
    </section>
  );
}

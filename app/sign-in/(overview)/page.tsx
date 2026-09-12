import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { getAuthSession } from "@db/services/auth/session";

export const metadata: Metadata = {
  title: "Sign in | Companion",
  description:
    "Sign in to Companion through Telegram or WhatsApp. No phone number to type.",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const callbackValue = params.callbackUrl;
  const callbackUrl = safeCallbackUrl(
    Array.isArray(callbackValue) ? callbackValue[0] : callbackValue
  );
  if (await getAuthSession(await headers())) redirect(callbackUrl);
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <p className="type-caption text-muted-foreground">
            Your assistant, one conversation away
          </p>
          <h1 className="type-page-title">Pick up the conversation</h1>
          <p className="type-supporting-body text-muted-foreground">
            Sign in through the messenger you use with your assistant. New here?
            See the{" "}
            <Link
              className="text-foreground underline underline-offset-4"
              href="/welcome"
            >
              product overview
            </Link>{" "}
            or start with{" "}
            <Link
              className="text-foreground underline underline-offset-4"
              href="/get-started"
            >
              Get started
            </Link>{" "}
            to create your account and bind a channel in one flow.
          </p>
        </div>
        {params.reason === "channel-unlinked" ? (
          <output className="type-supporting-body block text-muted-foreground">
            Channel disconnected. You were signed out of all browsers. Use a
            remaining linked channel to sign in again.
          </output>
        ) : null}
        <ChannelAuthForm purpose="login" callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}

import { LanguagePicker } from "@web/i18n/language-picker";
import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { getAuthSession } from "@db/services/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Sign in | Companion"),
    description: t(
      "Sign in to Companion through Telegram or WhatsApp. No phone number to type."
    ),
  };
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const { t } = await getI18n();
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
            {t("Your assistant, one conversation away")}
          </p>
          <h1 className="type-page-title">{t("Pick up the conversation")}</h1>
          <p className="type-supporting-body text-muted-foreground">
            {t(
              "Sign in through the messenger you use with your assistant. New here? See the"
            )}{" "}
            <Link
              className="text-foreground underline underline-offset-4"
              href="/welcome"
            >
              {t("product overview")}
            </Link>{" "}
            {t("or start with")}{" "}
            <Link
              className="text-foreground underline underline-offset-4"
              href="/get-started"
            >
              {t("Get started")}
            </Link>{" "}
            {t("to create your account and bind a channel in one flow.")}
          </p>
        </div>
        {params.reason === "channel-unlinked" ? (
          <output className="type-supporting-body block text-muted-foreground">
            {t(
              "Channel disconnected. You were signed out of all browsers. Use a remaining linked channel to sign in again."
            )}
          </output>
        ) : null}
        <ChannelAuthForm purpose="login" callbackUrl={callbackUrl} />
        <LanguagePicker />
      </section>
    </main>
  );
}

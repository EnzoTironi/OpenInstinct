import { LanguagePicker } from "@web/i18n/language-picker";
import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { getAuthSession } from "@db/services/auth/session";
import { env } from "@shared/environment";
import { GoogleSignInButton } from "@web/auth/google-button";
import { Logo } from "@web/components/ui/logo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Sign in | Zoen"),
    description: t("One account for your personal space and your teams."),
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
  const googleAvailable = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
  );
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm space-y-6">
        <Link
          className="inline-flex items-center gap-2 type-label"
          href="/welcome"
        >
          <Logo /> Zoen
        </Link>
        <div className="space-y-3">
          <h1 className="type-page-title">{t("Your space awaits.")}</h1>
          <p className="type-supporting-body text-muted-foreground">
            {t("One account for your personal space and your teams.")}
          </p>
        </div>
        {params.error ? (
          <p role="alert" className="type-caption text-destructive">
            {t(
              "Could not sign in. During beta, use the Google account on your invitation."
            )}
          </p>
        ) : null}
        {params.reason === "channel-unlinked" ? (
          <output className="type-supporting-body block text-muted-foreground">
            {t(
              "Channel disconnected. Sign in again with Google or another linked messenger."
            )}
          </output>
        ) : null}
        {googleAvailable ? (
          <>
            <GoogleSignInButton callbackUrl={callbackUrl} />
            <details className="border-t border-border pt-5">
              <summary className="cursor-pointer type-label text-muted-foreground">
                {t("Use a linked messenger")}
              </summary>
              <div className="pt-4">
                <ChannelAuthForm purpose="login" callbackUrl={callbackUrl} />
              </div>
            </details>
          </>
        ) : (
          <ChannelAuthForm purpose="login" callbackUrl={callbackUrl} />
        )}
        <LanguagePicker />
      </section>
    </main>
  );
}

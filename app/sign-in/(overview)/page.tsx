import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { getAuthSession } from "@db/services/auth/session";
import { env } from "@shared/environment";
import { OnboardingSignIn } from "@web/auth/onboarding/sign-in";
import { OnboardingShell } from "@web/auth/onboarding/shell";

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
    <OnboardingShell>
      <OnboardingSignIn
        googleAvailable={googleAvailable}
        callbackUrl={callbackUrl}
      >
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
      </OnboardingSignIn>
    </OnboardingShell>
  );
}

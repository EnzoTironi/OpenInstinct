import { headers } from "next/headers";
import { getAuthSession } from "@db/services/auth/session";
import { env } from "@shared/environment";
import { OnboardingShell } from "@web/auth/onboarding/shell";
import { OnboardingSignIn } from "@web/auth/onboarding/sign-in";
import { VaultContinue } from "./continue";
import { Predicate } from "effect";

export default async function VaultSignInPage({
  searchParams,
}: PageProps<"/vault/sign-in">) {
  const session = await getAuthSession(await headers());
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Predicate.isString(value)) query.set(key, value);
  }
  return (
    <OnboardingShell>
      {session ? (
        <VaultContinue />
      ) : (
        <OnboardingSignIn
          callbackUrl={`/vault/sign-in?${query.toString()}`}
          googleAvailable={Boolean(
            env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          )}
        />
      )}
    </OnboardingShell>
  );
}

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ChannelAuthForm } from "@app/sign-in/_components/channel-form";
import { safeCallbackUrl } from "@app/sign-in/_lib/channel-login";
import { getAuthSession } from "@db/services/auth/session";

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const callbackValue = (await searchParams).callbackUrl;
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
            Sign in through the messenger you use with your assistant.
          </p>
        </div>
        <ChannelAuthForm callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}

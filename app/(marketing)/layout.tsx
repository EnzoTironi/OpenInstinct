import { Effect } from "effect";
import { conversationDestinations } from "../../server/channels/destination";
import { OnboardingProvider } from "./_components/onboarding";

export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  const destinations = await Effect.runPromise(conversationDestinations);
  return (
    <OnboardingProvider destinations={destinations}>
      {children}
    </OnboardingProvider>
  );
}

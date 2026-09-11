import type {
  channelChallengeSchema,
  deviceBoundSchema,
  channelChallengeRequestSchema,
} from "@shared/identity/channel-auth";
import type { ChannelAuthorizationStatus } from "@web/auth/channel/client";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { Match } from "effect";

export function ChannelStatus({
  challenge,
  purpose,
  status,
  busy,
  error,
  onContinue,
  onRestart,
}: {
  readonly challenge:
    | typeof channelChallengeSchema.Type
    | typeof deviceBoundSchema.Type;
  readonly purpose: typeof channelChallengeRequestSchema.Type.purpose;
  readonly status: ChannelAuthorizationStatus;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onContinue: () => void;
  readonly onRestart: () => void;
}) {
  const messenger = challenge.channel === "telegram" ? "Telegram" : "WhatsApp";

  return (
    <div className="space-y-4">
      {purpose === "link" && "purpose" in challenge ? (
        <p className="type-supporting-body text-muted-foreground">
          This confirms the messenger’s existing association with the account
          signed in to this browser. Accounts and their data are not combined.
        </p>
      ) : null}
      <div aria-live="polite">
        {Match.value(status).pipe(
          Match.when("pending", () => (
            <>
              <h2 className="type-section-title">Confirm in {messenger}</h2>
              <p className="type-supporting-body mt-2 text-muted-foreground">
                {purpose === "login"
                  ? "Open the chat and confirm the request to sign in to this browser. Only approve a browser sign-in you requested. Then return to this tab."
                  : "purpose" in challenge
                    ? "Return to the messenger conversation where you requested this association. Confirm the request for the account already signed in to this browser, then return to this tab."
                    : "Open the messenger account you want to link and confirm the request to link it to your current Companion account. Only approve it if you started it here. Then return to this tab."}
              </p>
              {"deepLink" in challenge ? (
                <Button
                  className="mt-4 w-full"
                  nativeButton={false}
                  render={
                    <a
                      aria-label={`Open ${messenger} to confirm ${purpose === "login" ? "sign-in" : "account linking"}`}
                      href={challenge.deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    />
                  }
                >
                  Open {messenger}
                </Button>
              ) : null}
              <p className="mt-3 type-caption text-muted-foreground">
                Waiting for your confirmation. This request expires at{" "}
                {new Date(challenge.expiresAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                .
              </p>
            </>
          )),
          Match.when("confirmed", () => (
            <>
              <h2 className="type-section-title">Confirmed in {messenger}</h2>
              <p className="type-supporting-body mt-2 text-muted-foreground">
                {purpose === "login"
                  ? "Continue to sign in to this browser."
                  : "Finish linking this messenger account to your current Companion account."}
              </p>
              <Button
                className="mt-4 w-full"
                disabled={busy}
                onClick={onContinue}
                type="button"
              >
                {Match.value(purpose).pipe(
                  Match.when("login", () =>
                    busy ? "Signing in…" : "Enter this browser"
                  ),
                  Match.orElse(() =>
                    busy ? "Linking…" : "Finish linking account"
                  )
                )}
              </Button>
            </>
          )),
          Match.orElse(() => (
            <>
              <h2 className="type-section-title">
                {Match.value(status).pipe(
                  Match.when("expired", () => "This request has expired"),
                  Match.when("consumed", () => "This request was already used"),
                  Match.orElse(() => "This request could not be verified")
                )}
              </h2>
              <p className="type-supporting-body mt-2 text-muted-foreground">
                Start again to get a new request. Confirm only the new request
                in your chat.
              </p>
            </>
          ))
        )}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {purpose === "login"
              ? "Sign-in needs attention"
              : "Account linking needs attention"}
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        className="w-full"
        disabled={busy}
        onClick={onRestart}
        type="button"
        variant="outline"
      >
        Start again or choose another messenger
      </Button>
      <p className="type-caption text-muted-foreground">
        Keep this tab open until the request is complete.
      </p>
    </div>
  );
}

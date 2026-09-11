import type {
  channelChallengeSchema,
  deviceBoundSchema,
  channelChallengeRequestSchema,
} from "@shared/identity/channel-auth";
import type { ChannelAuthorizationStatus } from "@web/auth/channel/client";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { Match } from "effect";

type Challenge =
  | typeof channelChallengeSchema.Type
  | typeof deviceBoundSchema.Type;

type Purpose = typeof channelChallengeRequestSchema.Type.purpose;

function messengerName(channel: Challenge["channel"]): string {
  if (channel === "telegram") return "Telegram";

  return "WhatsApp";
}

function LinkPurposeNotice({
  challenge,
  purpose,
}: {
  readonly challenge: Challenge;
  readonly purpose: Purpose;
}) {
  if (purpose !== "link") return null;

  if (!("purpose" in challenge)) return null;

  return (
    <p className="type-supporting-body text-muted-foreground">
      This confirms the messenger’s existing association with the account signed
      in to this browser. Accounts and their data are not combined.
    </p>
  );
}

function pendingLoginCopy(): string {
  return "Open the chat and confirm the request to sign in to this browser. Only approve a browser sign-in you requested. Then return to this tab.";
}

function pendingLinkCopy(challenge: Challenge): string {
  if ("purpose" in challenge) {
    return "Return to the messenger conversation where you requested this association. Confirm the request for the account already signed in to this browser, then return to this tab.";
  }

  return "Open the messenger account you want to link and confirm the request to link it to your current Companion account. Only approve it if you started it here. Then return to this tab.";
}

function PendingDeepLink({
  challenge,
  messenger,
  purpose,
}: {
  readonly challenge: Challenge;
  readonly messenger: string;
  readonly purpose: Purpose;
}) {
  if (!("deepLink" in challenge)) return null;

  const actionLabel = purpose === "login" ? "sign-in" : "account linking";

  return (
    <Button
      className="mt-4 w-full"
      nativeButton={false}
      render={
        <a
          aria-label={`Open ${messenger} to confirm ${actionLabel}`}
          href={challenge.deepLink}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        />
      }
    >
      Open {messenger}
    </Button>
  );
}

function PendingStatus({
  challenge,
  messenger,
  purpose,
}: {
  readonly challenge: Challenge;
  readonly messenger: string;
  readonly purpose: Purpose;
}) {
  const copy =
    purpose === "login" ? pendingLoginCopy() : pendingLinkCopy(challenge);

  return (
    <>
      <h2 className="type-section-title">Confirm in {messenger}</h2>
      <p className="type-supporting-body mt-2 text-muted-foreground">{copy}</p>
      <PendingDeepLink
        challenge={challenge}
        messenger={messenger}
        purpose={purpose}
      />
      <p className="mt-3 type-caption text-muted-foreground">
        Waiting for your confirmation. This request expires at{" "}
        {new Date(challenge.expiresAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
        .
      </p>
    </>
  );
}

function continueButtonLabel(purpose: Purpose, busy: boolean): string {
  if (purpose === "login") {
    if (busy) return "Signing in…";

    return "Enter this browser";
  }

  if (busy) return "Linking…";

  return "Finish linking account";
}

function ConfirmedStatus({
  messenger,
  purpose,
  busy,
  onContinue,
}: {
  readonly messenger: string;
  readonly purpose: Purpose;
  readonly busy: boolean;
  readonly onContinue: () => void;
}) {
  const body =
    purpose === "login"
      ? "Continue to sign in to this browser."
      : "Finish linking this messenger account to your current Companion account.";

  return (
    <>
      <h2 className="type-section-title">Confirmed in {messenger}</h2>
      <p className="type-supporting-body mt-2 text-muted-foreground">{body}</p>
      <Button
        className="mt-4 w-full"
        disabled={busy}
        onClick={onContinue}
        type="button"
      >
        {continueButtonLabel(purpose, busy)}
      </Button>
    </>
  );
}

function failedTitle(status: ChannelAuthorizationStatus): string {
  return Match.value(status).pipe(
    Match.when("expired", () => "This request has expired"),
    Match.when("consumed", () => "This request was already used"),
    Match.orElse(() => "This request could not be verified")
  );
}

function FailedStatus({
  status,
}: {
  readonly status: ChannelAuthorizationStatus;
}) {
  return (
    <>
      <h2 className="type-section-title">{failedTitle(status)}</h2>
      <p className="type-supporting-body mt-2 text-muted-foreground">
        Start again to get a new request. Confirm only the new request in your
        chat.
      </p>
    </>
  );
}

function StatusBody({
  challenge,
  messenger,
  purpose,
  status,
  busy,
  onContinue,
}: {
  readonly challenge: Challenge;
  readonly messenger: string;
  readonly purpose: Purpose;
  readonly status: ChannelAuthorizationStatus;
  readonly busy: boolean;
  readonly onContinue: () => void;
}) {
  if (status === "pending") {
    return (
      <PendingStatus
        challenge={challenge}
        messenger={messenger}
        purpose={purpose}
      />
    );
  }

  if (status === "confirmed") {
    return (
      <ConfirmedStatus
        messenger={messenger}
        purpose={purpose}
        busy={busy}
        onContinue={onContinue}
      />
    );
  }

  return <FailedStatus status={status} />;
}

function StatusError({
  error,
  purpose,
}: {
  readonly error: string | undefined;
  readonly purpose: Purpose;
}) {
  if (!error) return null;

  const title =
    purpose === "login"
      ? "Sign-in needs attention"
      : "Account linking needs attention";

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

export function ChannelStatus({
  challenge,
  purpose,
  status,
  busy,
  error,
  onContinue,
  onRestart,
}: {
  readonly challenge: Challenge;
  readonly purpose: Purpose;
  readonly status: ChannelAuthorizationStatus;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onContinue: () => void;
  readonly onRestart: () => void;
}) {
  const messenger = messengerName(challenge.channel);

  return (
    <div className="space-y-4">
      <LinkPurposeNotice challenge={challenge} purpose={purpose} />
      <div aria-live="polite">
        <StatusBody
          challenge={challenge}
          messenger={messenger}
          purpose={purpose}
          status={status}
          busy={busy}
          onContinue={onContinue}
        />
      </div>
      <StatusError error={error} purpose={purpose} />
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

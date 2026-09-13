"use client";

import { useI18n } from "@web/i18n/context";
import type { ChannelAuthorizationStatus } from "@web/auth/channel/client";
import type {
  channelChallengeSchema,
  deviceBoundSchema,
  channelChallengeRequestSchema,
} from "@shared/identity/channel-auth";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";

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
  const { t, locale } = useI18n();
  const messenger = challenge.channel === "telegram" ? "Telegram" : "WhatsApp";
  return (
    <div className="space-y-4">
      {purpose === "link" && "purpose" in challenge ? (
        <p className="type-supporting-body text-muted-foreground">
          {t(
            "This confirms the messenger’s existing association with the account signed in to this browser. Accounts and their data are not combined."
          )}
        </p>
      ) : null}
      <div aria-live="polite">
        {status === "pending" ? (
          <>
            <h2 className="type-section-title">
              {t("Confirm in")} {messenger}
            </h2>
            <p className="type-supporting-body mt-2 text-muted-foreground">
              {purpose === "login"
                ? t(
                    "Open the chat and confirm the request to sign in to this browser. Only approve a browser sign-in you requested. Then return to this tab."
                  )
                : "purpose" in challenge
                  ? t(
                      "Return to the messenger conversation where you requested this association. Confirm the request for the account already signed in to this browser, then return to this tab."
                    )
                  : t(
                      "Open the messenger account you want to link and confirm the request to link it to your current Companion account. Only approve it if you started it here. Then return to this tab."
                    )}
            </p>
            {"deepLink" in challenge ? (
              <Button
                className="mt-4 w-full"
                nativeButton={false}
                render={
                  <a
                    aria-label={t("Abrir {messenger} para confirmar", {
                      messenger,
                    })}
                    href={challenge.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  />
                }
              >
                {t("Open")} {messenger}
              </Button>
            ) : null}
            <p className="mt-3 type-caption text-muted-foreground">
              {t("Waiting for your confirmation. This request expires at")}{" "}
              {new Date(challenge.expiresAt).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
              .
            </p>
          </>
        ) : status === "confirmed" ? (
          <>
            <h2 className="type-section-title">
              {t("Confirmed in")} {messenger}
            </h2>
            <p className="type-supporting-body mt-2 text-muted-foreground">
              {purpose === "login"
                ? t("Continue to sign in to this browser.")
                : t(
                    "Finish linking this messenger account to your current Companion account."
                  )}
            </p>
            <Button
              className="mt-4 w-full"
              disabled={busy}
              onClick={onContinue}
              type="button"
            >
              {busy
                ? purpose === "login"
                  ? t("Signing in…")
                  : t("Linking…")
                : purpose === "login"
                  ? t("Enter this browser")
                  : t("Finish linking account")}
            </Button>
          </>
        ) : (
          <>
            <h2 className="type-section-title">
              {status === "expired"
                ? t("This request has expired")
                : status === "consumed"
                  ? t("This request was already used")
                  : t("This request could not be verified")}
            </h2>
            <p className="type-supporting-body mt-2 text-muted-foreground">
              {t(
                "Start again to get a new request. Confirm only the new request in your chat."
              )}
            </p>
          </>
        )}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {purpose === "login"
              ? t("Sign-in needs attention")
              : t("Account linking needs attention")}
          </AlertTitle>
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        className="w-full"
        disabled={busy}
        onClick={onRestart}
        type="button"
        variant="outline"
      >
        {t("Start again or choose another messenger")}
      </Button>
      <p className="type-caption text-muted-foreground">
        {t("Keep this tab open until the request is complete.")}
      </p>
    </div>
  );
}

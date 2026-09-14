"use client";

import { useState, useTransition } from "react";
import { Effect } from "effect";
import { Button } from "@web/components/ui/button";
import { GoogleIcon } from "@web/components/ui/google-icon";
import { useI18n } from "@web/i18n/context";
import { authClient } from "./client";
import { safeCallbackUrl } from "./channel/client";

export function GoogleSignInButton({
  callbackUrl,
}: {
  readonly callbackUrl: string;
}) {
  const { t } = useI18n();
  const [busy, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={() => {
          setFailed(false);
          startTransition(async () => {
            await Effect.runPromise(
              Effect.tryPromise(() =>
                authClient.signIn.social({
                  provider: "google",
                  callbackURL: safeCallbackUrl(callbackUrl),
                  errorCallbackURL: `/sign-in?error=google&callbackUrl=${encodeURIComponent(safeCallbackUrl(callbackUrl))}`,
                })
              ).pipe(
                Effect.match({
                  onFailure: () => {
                    setFailed(true);
                  },
                  onSuccess: (result) => {
                    setFailed(Boolean(result.error));
                  },
                })
              )
            );
          });
        }}
      >
        <GoogleIcon className="size-5" />
        {t(busy ? "Opening Google…" : "Continue with Google")}
      </Button>
      {failed ? (
        <p role="alert" className="type-caption text-destructive">
          {t("Could not open Google. Please try again.")}
        </p>
      ) : null}
    </div>
  );
}

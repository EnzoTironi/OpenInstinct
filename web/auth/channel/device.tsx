"use client";

import { useI18n } from "@web/i18n/context";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  deviceBoundSchema,
  deviceRequestSchema,
} from "@shared/identity/channel-auth";
import { Effect } from "effect";
import {
  bindNativeBrowser,
  resumeNativeBrowser,
  channelFailureMessage,
  channelHttpError,
  type ChannelAuthorizationError,
} from "./client";
import {
  PendingAuthorization,
  useAuthorizationRequest,
  SignInAgain,
} from "./form";
import { Button } from "@web/components/ui/button";

export function NativeDeviceForm({
  id,
  purpose,
}: typeof deviceRequestSchema.Type) {
  const { t } = useI18n();
  const [bound, setBound] = useState<typeof deviceBoundSchema.Type>();
  const action = useAuthorizationRequest();
  const [loading, setLoading] = useState(true);
  const [resumeError, setResumeError] = useState<ChannelAuthorizationError>();
  useEffect(() => {
    const controller = new AbortController();
    void Effect.runPromise(
      resumeNativeBrowser({ id, purpose }).pipe(
        Effect.match({
          onSuccess: setBound,
          onFailure: (failure) => {
            if (!window.location.hash) setResumeError(failure);
          },
        })
      ),
      { signal: controller.signal }
    )
      .catch(() => {
        if (!controller.signal.aborted) setResumeError(channelHttpError(0));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [id, purpose]);
  if (loading) return <output>{t("Checking this browser…")}</output>;
  if (resumeError)
    return (
      <DeviceChallengeRecovery
        message={channelFailureMessage(resumeError, purpose)}
        purpose={purpose}
        showSignInAgain={purpose === "link" && resumeError.status === 401}
      />
    );
  if (bound)
    return (
      <PendingAuthorization
        challenge={bound}
        purpose={bound.purpose}
        callbackUrl={bound.purpose === "link" ? "/account" : "/"}
        onRestart={() => {
          window.location.assign(purpose === "link" ? "/account" : "/sign-in");
        }}
      />
    );
  return (
    <div className="space-y-4">
      <p>
        {purpose === "link"
          ? t(
              "Use the account recently signed in to this browser, then return to your messenger conversation to confirm the association. If your messenger belongs to another account, the request will be refused. Accounts and their data are not combined."
            )
          : t(
              "Bind this browser, then return to your messenger conversation and tell the assistant you are ready. You will be asked to approve this browser’s sign-in there."
            )}
      </p>
      <Button
        type="button"
        disabled={action.busy}
        onClick={() => {
          action.run(
            bindNativeBrowser({
              id,
              purpose,
              token: window.location.hash.slice(1),
            }),
            (result) => {
              window.history.replaceState(
                null,
                "",
                `${window.location.pathname}?id=${encodeURIComponent(id)}&purpose=${purpose}`
              );
              setBound(result);
            }
          );
        }}
      >
        {action.busy ? t("Binding browser…") : t("Use this browser")}
      </Button>
      {action.error ? (
        <p role="alert">{t(channelFailureMessage(action.error, purpose))}</p>
      ) : null}
      {purpose === "link" && action.error?.status === 401 ? (
        <SignInAgain callbackUrl="/account" />
      ) : null}
      {action.error ? (
        <Button
          nativeButton={false}
          render={<Link href={purpose === "link" ? "/account" : "/sign-in"} />}
          variant="outline"
        >
          {t("Start again")}
        </Button>
      ) : null}
    </div>
  );
}

export function DeviceChallengeRecovery({
  message,
  purpose,
  showSignInAgain,
}: {
  readonly message: string;
  readonly purpose: typeof deviceRequestSchema.Type.purpose;
  readonly showSignInAgain: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <p role="alert">{message}</p>
      <Button
        nativeButton={false}
        render={<Link href={purpose === "link" ? "/account" : "/sign-in"} />}
        variant="outline"
      >
        {t("Start again")}
      </Button>
      {showSignInAgain ? <SignInAgain callbackUrl="/account" /> : null}
    </div>
  );
}

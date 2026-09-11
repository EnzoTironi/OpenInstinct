"use client";

import type {
  deviceBoundSchema,
  deviceRequestSchema,
} from "@shared/identity/channel-auth";
import { Button } from "@web/components/ui/button";
import { Effect } from "effect";
import { useEffect, useState } from "react";

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

type Purpose = typeof deviceRequestSchema.Type.purpose;

function LinkAuthError({
  purpose,
  error,
}: {
  readonly purpose: Purpose;
  readonly error: ChannelAuthorizationError | undefined;
}) {
  if (purpose !== "link") return null;

  if (error?.status !== 401) return null;

  return <SignInAgain callbackUrl="/account" />;
}

function ResumeErrorView({
  purpose,
  error,
}: {
  readonly purpose: Purpose;
  readonly error: ChannelAuthorizationError;
}) {
  return (
    <div className="space-y-4">
      <p role="alert">{channelFailureMessage(error, purpose)}</p>
      <LinkAuthError purpose={purpose} error={error} />
    </div>
  );
}

function boundCallbackUrl(purpose: Purpose): string {
  if (purpose === "link") return "/account";

  return "/";
}

function restartDestination(purpose: Purpose): string {
  if (purpose === "link") return "/account";

  return "/sign-in";
}

function BoundView({
  bound,
  purpose,
}: {
  readonly bound: typeof deviceBoundSchema.Type;
  readonly purpose: Purpose;
}) {
  return (
    <PendingAuthorization
      challenge={bound}
      purpose={bound.purpose}
      callbackUrl={boundCallbackUrl(bound.purpose)}
      onRestart={() => {
        window.location.assign(restartDestination(purpose));
      }}
    />
  );
}

function bindCopy(purpose: Purpose): string {
  if (purpose === "link") {
    return "Use the account recently signed in to this browser, then return to your messenger conversation to confirm the association. If your messenger belongs to another account, the request will be refused. Accounts and their data are not combined.";
  }

  return "Bind this browser, then return to your messenger conversation and tell the assistant you are ready. You will be asked to approve this browser’s sign-in there.";
}

function bindButtonLabel(busy: boolean): string {
  if (busy) return "Binding browser…";

  return "Use this browser";
}

function BindView({
  id,
  purpose,
  action,
  onBound,
}: {
  readonly id: string;
  readonly purpose: Purpose;
  readonly action: ReturnType<typeof useAuthorizationRequest>;
  readonly onBound: (result: typeof deviceBoundSchema.Type) => void;
}) {
  return (
    <div className="space-y-4">
      <p>{bindCopy(purpose)}</p>
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
              onBound(result);
            }
          );
        }}
      >
        {bindButtonLabel(action.busy)}
      </Button>
      {action.error ? (
        <p role="alert">{channelFailureMessage(action.error, purpose)}</p>
      ) : null}
      <LinkAuthError purpose={purpose} error={action.error} />
    </div>
  );
}

function resumeFailureHandler(
  setResumeError: (failure: ChannelAuthorizationError) => void
) {
  return (failure: ChannelAuthorizationError) => {
    if (!window.location.hash) setResumeError(failure);
  };
}

export function NativeDeviceForm({
  id,
  purpose,
}: typeof deviceRequestSchema.Type) {
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
          onFailure: resumeFailureHandler(setResumeError),
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

  if (loading) return <output>Checking this browser…</output>;

  if (resumeError) {
    return <ResumeErrorView purpose={purpose} error={resumeError} />;
  }

  if (bound) {
    return <BoundView bound={bound} purpose={purpose} />;
  }

  return (
    <BindView id={id} purpose={purpose} action={action} onBound={setBound} />
  );
}

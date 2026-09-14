"use client";

import { useI18n } from "@web/i18n/context";

import type {
  ChannelAuthorizationError,
  ChannelAuthorizationStatus,
} from "@web/auth/channel/client";
import { Effect, Result } from "effect";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  channelChallengeSchema,
  deviceBoundSchema,
  channelChallengeRequestSchema,
  channelProviderSchema,
} from "@shared/identity/channel-auth";
import {
  checkChannelAuthorization,
  channelAuthorizationPollIntervalMs,
  channelFailureMessage,
  completeChannelAuthorization,
  channelHttpError,
  channelPollFailure,
  safeCallbackUrl,
  reauthenticationDestination,
  startChannelAuthorization,
} from "@web/auth/channel/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { ChannelStatus } from "./status";
import { authClient } from "@web/auth/client";

export function ChannelAuthForm({
  callbackUrl,
  purpose,
  children,
  onComplete,
}: {
  readonly callbackUrl: string;
  readonly purpose: typeof channelChallengeRequestSchema.Type.purpose;
  readonly onComplete?: (channel: typeof channelProviderSchema.Type) => void;
  readonly children?: (request: {
    start: (channel: typeof channelProviderSchema.Type) => void;
    busy: boolean;
  }) => ReactNode;
}) {
  const { t } = useI18n();
  const [challenge, setChallenge] =
    useState<typeof channelChallengeSchema.Type>();
  const action = useAuthorizationRequest();
  function start(channel: typeof channelProviderSchema.Type) {
    action.run(startChannelAuthorization(channel, purpose), (result) => {
      if ("conversationUrl" in result)
        window.location.assign(result.conversationUrl);
      else setChallenge(result);
    });
  }

  if (challenge)
    return (
      <PendingAuthorization
        key={challenge.id}
        challenge={challenge}
        callbackUrl={callbackUrl}
        purpose={purpose}
        onComplete={onComplete}
        onRestart={() => {
          setChallenge(undefined);
        }}
      />
    );
  return (
    <div className="space-y-3">
      {children ? (
        children({ start, busy: action.busy })
      ) : (
        <ChannelChoices purpose={purpose} start={start} busy={action.busy} />
      )}
      {action.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t(channelFailureMessage(action.error, purpose))}
          </AlertDescription>
        </Alert>
      ) : null}
      {purpose === "link" && action.error?.status === 401 ? (
        <SignInAgain callbackUrl={callbackUrl} />
      ) : null}
    </div>
  );
}

function ChannelChoices({
  purpose,
  start,
  busy,
}: {
  readonly purpose: typeof channelChallengeRequestSchema.Type.purpose;
  readonly start: (channel: typeof channelProviderSchema.Type) => void;
  readonly busy: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <Button
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={() => {
          start("telegram");
        }}
        type="button"
      >
        {busy
          ? purpose === "login"
            ? t("Preparing sign-in…")
            : t("Preparing link…")
          : purpose === "login"
            ? t("Continue with Telegram")
            : t("Link Telegram")}
      </Button>
      <Button
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={() => {
          start("kapso");
        }}
        type="button"
        variant="outline"
      >
        {purpose === "login" ? t("Continue with WhatsApp") : t("Link WhatsApp")}
      </Button>
      <p className="type-caption text-muted-foreground">
        {purpose === "login"
          ? t(
              "Choose a messenger, confirm this browser’s sign-in in chat, then return here. No phone number or password to enter."
            )
          : t(
              "Choose the messenger account you want to link. Confirm the link in that chat, then return here to finish. A recent sign-in is required."
            )}
      </p>
    </>
  );
}

export function PendingAuthorization({
  challenge,
  callbackUrl,
  purpose,
  onRestart,
  onComplete,
}: {
  readonly challenge:
    | typeof channelChallengeSchema.Type
    | typeof deviceBoundSchema.Type;
  readonly callbackUrl: string;
  readonly purpose: typeof channelChallengeRequestSchema.Type.purpose;
  readonly onRestart: () => void;
  readonly onComplete?: (channel: typeof channelProviderSchema.Type) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState<ChannelAuthorizationStatus>("pending");
  const [error, setError] = useState<string>();
  const action = useAuthorizationRequest();

  useEffect(() => {
    if (status !== "pending" && status !== "confirmed") return undefined;
    const controller = new AbortController();
    const remaining = Math.max(0, Date.parse(challenge.expiresAt) - Date.now());
    const timer = setTimeout(
      () => {
        controller.abort();
        setStatus("expired");
      },
      Math.min(remaining, 2_147_483_647)
    );
    if (status === "pending") {
      const poll = Effect.gen(function* pollConfirmation() {
        let failures = 0;
        while (Date.now() < Date.parse(challenge.expiresAt)) {
          const result = yield* checkChannelAuthorization(challenge.id).pipe(
            Effect.result
          );
          let delay = channelAuthorizationPollIntervalMs;
          if (Result.isSuccess(result)) {
            failures = 0;
            setError(undefined);
            if (result.success.status !== "pending") {
              setStatus(result.success.status);
              return;
            }
          } else {
            const next = channelPollFailure(
              result.failure,
              failures,
              Date.now(),
              Date.parse(challenge.expiresAt)
            );
            setError(
              next.status === "invalid"
                ? `${t(channelFailureMessage(result.failure, purpose))} ${t("Comece um novo pedido para continuar.")}`
                : t(channelFailureMessage(result.failure, purpose))
            );
            if (next.status !== "pending") {
              setStatus(next.status);
              return;
            }
            failures = next.failures;
            delay = next.delay;
          }
          yield* Effect.sleep(delay);
        }
        setStatus("expired");
      });
      void Effect.runPromise(poll, { signal: controller.signal }).catch(() => {
        if (!controller.signal.aborted)
          setError(t(channelHttpError(0).message));
      });
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [challenge, status, purpose, t]);

  function complete() {
    if (status !== "confirmed") return;
    if (Date.now() >= Date.parse(challenge.expiresAt)) {
      setStatus("expired");
      return;
    }
    action.run(completeChannelAuthorization(challenge.id), () => {
      if (purpose === "link") onRestart();
      if (onComplete) {
        onComplete(challenge.channel);
        return;
      }
      router.replace(safeCallbackUrl(callbackUrl));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ChannelStatus
        challenge={challenge}
        purpose={purpose}
        status={status}
        busy={action.busy}
        error={
          action.error ? t(channelFailureMessage(action.error, purpose)) : error
        }
        onContinue={complete}
        onRestart={onRestart}
      />
      {purpose === "link" && action.error?.status === 401 ? (
        <SignInAgain callbackUrl={callbackUrl} />
      ) : null}
    </div>
  );
}

export function useAuthorizationRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChannelAuthorizationError>();
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);

  function run<A>(
    operation: Effect.Effect<A, ChannelAuthorizationError>,
    onSuccess: (value: A) => void
  ) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    void Effect.runPromise(
      operation.pipe(
        Effect.match({
          onFailure: (failure) => {
            setError(failure);
          },
          onSuccess,
        })
      ),
      { signal: controller.signal }
    )
      .catch(() => {
        if (!controller.signal.aborted) setError(channelHttpError(0));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          active.current = undefined;
          setBusy(false);
        }
      });
  }
  return { busy, error, run };
}

export function SignInAgain({ callbackUrl }: { readonly callbackUrl: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void Promise.allSettled([authClient.signOut()]).then(([outcome]) => {
            const destination = reauthenticationDestination(
              outcome,
              callbackUrl
            );
            if (destination) {
              window.location.assign(destination);
              return undefined;
            }
            setFailed(true);
            setBusy(false);
            return undefined;
          });
        }}
      >
        {busy ? t("Signing out…") : t("Sign in again")}
      </Button>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("Unable to sign out. Check your connection and try again.")}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

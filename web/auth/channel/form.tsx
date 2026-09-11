"use client";

import type {
  channelChallengeSchema,
  deviceBoundSchema,
  channelChallengeRequestSchema,
  channelProviderSchema,
} from "@shared/identity/channel-auth";
import type {
  ChannelAuthorizationError,
  ChannelAuthorizationStatus,
} from "@web/auth/channel/client";
import {
  checkChannelAuthorization,
  channelFailureMessage,
  completeChannelAuthorization,
  channelHttpError,
  channelPollFailure,
  safeCallbackUrl,
  reauthenticationDestination,
  startChannelAuthorization,
} from "@web/auth/channel/client";
import { authClient } from "@web/auth/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { Clock, Effect, Result } from "effect";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ChannelStatus } from "./status";

export function ChannelAuthForm({
  callbackUrl,
  purpose,
}: {
  readonly callbackUrl: string;
  readonly purpose: typeof channelChallengeRequestSchema.Type.purpose;
}) {
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
        onRestart={() => {
          setChallenge(undefined);
        }}
      />
    );

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        size="lg"
        disabled={action.busy}
        onClick={() => {
          start("telegram");
        }}
        type="button"
      >
        {action.busy
          ? purpose === "login"
            ? "Preparing sign-in…"
            : "Preparing link…"
          : purpose === "login"
            ? "Continue with Telegram"
            : "Link Telegram"}
      </Button>
      <Button
        className="w-full"
        size="lg"
        disabled={action.busy}
        onClick={() => {
          start("kapso");
        }}
        type="button"
        variant="outline"
      >
        {purpose === "login" ? "Continue with WhatsApp" : "Link WhatsApp"}
      </Button>
      {action.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {channelFailureMessage(action.error, purpose)}
          </AlertDescription>
        </Alert>
      ) : null}
      {purpose === "link" && action.error?.status === 401 ? (
        <SignInAgain callbackUrl={callbackUrl} />
      ) : null}
      <p className="type-caption text-muted-foreground">
        {purpose === "login"
          ? "Choose a messenger, confirm this browser’s sign-in in chat, then return here. No phone number or password to enter."
          : "Choose the messenger account you want to link. Confirm the link in that chat, then return here to finish. A recent sign-in is required."}
      </p>
    </div>
  );
}

export function PendingAuthorization({
  challenge,
  callbackUrl,
  purpose,
  onRestart,
}: {
  readonly challenge:
    | typeof channelChallengeSchema.Type
    | typeof deviceBoundSchema.Type;
  readonly callbackUrl: string;
  readonly purpose: typeof channelChallengeRequestSchema.Type.purpose;
  readonly onRestart: () => void;
}) {
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
      const expiresAtMs = Date.parse(challenge.expiresAt);

      const poll = Effect.gen(function* pollConfirmation() {
        let failures = 0;

        const tick: Effect.Effect<void> = Effect.suspend(() =>
          Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) >= expiresAtMs) {
              setStatus("expired");

              return;
            }

            const result = yield* checkChannelAuthorization(challenge.id).pipe(
              Effect.result
            );

            let delay = 2000;

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
                yield* Clock.currentTimeMillis,
                expiresAtMs
              );

              setError(
                next.status === "invalid"
                  ? `${channelFailureMessage(result.failure, purpose)} Start a new request to continue.`
                  : channelFailureMessage(result.failure, purpose)
              );

              if (next.status !== "pending") {
                setStatus(next.status);

                return;
              }

              failures = next.failures;
              delay = next.delay;
            }

            yield* Effect.sleep(delay);
            yield* tick;
          })
        );

        yield* tick;
      });

      void Effect.runPromise(poll, { signal: controller.signal }).catch(() => {
        if (!controller.signal.aborted) setError(channelHttpError(0).message);
      });
    }

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [challenge, status, purpose]);

  function complete() {
    if (status !== "confirmed") return;

    if (new Date() >= new Date(challenge.expiresAt)) {
      setStatus("expired");

      return;
    }

    action.run(completeChannelAuthorization(challenge.id), () => {
      if (purpose === "link") onRestart();
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
          action.error ? channelFailureMessage(action.error, purpose) : error
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
        {busy ? "Signing out…" : "Sign in again"}
      </Button>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to sign out. Check your connection and try again.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

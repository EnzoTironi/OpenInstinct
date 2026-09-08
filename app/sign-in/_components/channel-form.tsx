"use client";

import type {
  ChannelLoginError,
  ChannelLoginStatus,
} from "@app/sign-in/_lib/channel-login";
import { Effect, Result } from "effect";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  channelChallengeSchema,
  channelProviderSchema,
} from "@shared/identity/channel-auth";
import {
  checkChannelLogin,
  completeChannelLogin,
  loginHttpError,
  loginPollFailure,
  safeCallbackUrl,
  startChannelLogin,
} from "@app/sign-in/_lib/channel-login";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { ChannelStatus } from "./channel-status";

export function ChannelAuthForm({
  callbackUrl,
}: {
  readonly callbackUrl: string;
}) {
  const [challenge, setChallenge] =
    useState<typeof channelChallengeSchema.Type>();
  const action = useLoginRequest();
  function start(channel: typeof channelProviderSchema.Type) {
    action.run(startChannelLogin(channel), setChallenge);
  }

  if (challenge)
    return (
      <PendingLogin
        key={challenge.id}
        challenge={challenge}
        callbackUrl={callbackUrl}
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
        {action.busy ? "Preparing sign-in…" : "Continue with Telegram"}
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
        Continue with WhatsApp
      </Button>
      {action.error ? (
        <Alert variant="destructive">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      <p className="type-caption text-muted-foreground">
        Choose a messenger, confirm this browser’s sign-in in chat, then return
        here. No phone number or password to enter.
      </p>
    </div>
  );
}

function PendingLogin({
  challenge,
  callbackUrl,
  onRestart,
}: {
  readonly challenge: typeof channelChallengeSchema.Type;
  readonly callbackUrl: string;
  readonly onRestart: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ChannelLoginStatus>("pending");
  const [error, setError] = useState<string>();
  const action = useLoginRequest();

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
          const result = yield* checkChannelLogin(challenge.id).pipe(
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
            const next = loginPollFailure(
              result.failure,
              failures,
              Date.now(),
              Date.parse(challenge.expiresAt)
            );
            setError(
              next.status === "invalid"
                ? `${result.failure.message} Start a new request to continue.`
                : result.failure.message
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
        if (!controller.signal.aborted) setError(loginHttpError(0).message);
      });
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [challenge, status]);

  function complete() {
    if (status !== "confirmed") return;
    if (Date.now() >= Date.parse(challenge.expiresAt)) {
      setStatus("expired");
      return;
    }
    action.run(completeChannelLogin(challenge.id), () => {
      router.replace(safeCallbackUrl(callbackUrl));
      router.refresh();
    });
  }

  return (
    <ChannelStatus
      challenge={challenge}
      status={status}
      busy={action.busy}
      error={action.error ?? error}
      onContinue={complete}
      onRestart={onRestart}
    />
  );
}

function useLoginRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);

  function run<A>(
    operation: Effect.Effect<A, ChannelLoginError>,
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
            setError(failure.message);
          },
          onSuccess,
        })
      ),
      { signal: controller.signal }
    )
      .catch(() => {
        if (!controller.signal.aborted) setError(loginHttpError(0).message);
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

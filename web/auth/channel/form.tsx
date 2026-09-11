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

type Purpose = typeof channelChallengeRequestSchema.Type.purpose;

type Channel = typeof channelProviderSchema.Type;

type Challenge = typeof channelChallengeSchema.Type;

function telegramBusyLabel(purpose: Purpose): string {
  if (purpose === "login") return "Preparing sign-in…";

  return "Preparing link…";
}

function telegramIdleLabel(purpose: Purpose): string {
  if (purpose === "login") return "Continue with Telegram";

  return "Link Telegram";
}

function telegramButtonLabel(busy: boolean, purpose: Purpose): string {
  if (busy) return telegramBusyLabel(purpose);

  return telegramIdleLabel(purpose);
}

function whatsappButtonLabel(purpose: Purpose): string {
  if (purpose === "login") return "Continue with WhatsApp";

  return "Link WhatsApp";
}

function channelHelpCopy(purpose: Purpose): string {
  if (purpose === "login") {
    return "Choose a messenger, confirm this browser’s sign-in in chat, then return here. No phone number or password to enter.";
  }

  return "Choose the messenger account you want to link. Confirm the link in that chat, then return here to finish. A recent sign-in is required.";
}

function LinkUnauthorized({
  purpose,
  error,
  callbackUrl,
}: {
  readonly purpose: Purpose;
  readonly error: ChannelAuthorizationError | undefined;
  readonly callbackUrl: string;
}) {
  if (purpose !== "link") return null;

  if (error?.status !== 401) return null;

  return <SignInAgain callbackUrl={callbackUrl} />;
}

function startChannel(channel: Channel, onStart: (channel: Channel) => void) {
  return () => {
    onStart(channel);
  };
}

function ChannelChooser({
  purpose,
  callbackUrl,
  busy,
  error,
  onStart,
}: {
  readonly purpose: Purpose;
  readonly callbackUrl: string;
  readonly busy: boolean;
  readonly error: ChannelAuthorizationError | undefined;
  readonly onStart: (channel: Channel) => void;
}) {
  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={startChannel("telegram", onStart)}
        type="button"
      >
        {telegramButtonLabel(busy, purpose)}
      </Button>
      <Button
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={startChannel("kapso", onStart)}
        type="button"
        variant="outline"
      >
        {whatsappButtonLabel(purpose)}
      </Button>
      <ChannelChooserError purpose={purpose} error={error} />
      <LinkUnauthorized
        purpose={purpose}
        error={error}
        callbackUrl={callbackUrl}
      />
      <p className="type-caption text-muted-foreground">
        {channelHelpCopy(purpose)}
      </p>
    </div>
  );
}

function ChannelChooserError({
  purpose,
  error,
}: {
  readonly purpose: Purpose;
  readonly error: ChannelAuthorizationError | undefined;
}) {
  if (!error) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertDescription>
        {channelFailureMessage(error, purpose)}
      </AlertDescription>
    </Alert>
  );
}

function applyStartResult(
  result: Challenge | { readonly conversationUrl: string },
  setChallenge: (challenge: Challenge) => void
) {
  if ("conversationUrl" in result) {
    window.location.assign(result.conversationUrl);

    return;
  }

  setChallenge(result);
}

function createStartHandler(
  action: ReturnType<typeof useAuthorizationRequest>,
  purpose: Purpose,
  setChallenge: (challenge: Challenge | undefined) => void
) {
  return (channel: Channel) => {
    action.run(
      startChannelAuthorization(channel, purpose),
      applyStartedChallenge(setChallenge)
    );
  };
}

function applyStartedChallenge(
  setChallenge: (challenge: Challenge | undefined) => void
) {
  return (result: Challenge | { readonly conversationUrl: string }) => {
    applyStartResult(result, setChallenge);
  };
}

function clearChallenge(
  setChallenge: (challenge: Challenge | undefined) => void
) {
  return () => {
    setChallenge(undefined);
  };
}

export function ChannelAuthForm({
  callbackUrl,
  purpose,
}: {
  readonly callbackUrl: string;
  readonly purpose: Purpose;
}) {
  const [challenge, setChallenge] = useState<Challenge>();
  const action = useAuthorizationRequest();

  if (challenge) {
    return (
      <PendingAuthorization
        key={challenge.id}
        challenge={challenge}
        callbackUrl={callbackUrl}
        purpose={purpose}
        onRestart={clearChallenge(setChallenge)}
      />
    );
  }

  return (
    <ChannelChooser
      purpose={purpose}
      callbackUrl={callbackUrl}
      busy={action.busy}
      error={action.error}
      onStart={createStartHandler(action, purpose, setChallenge)}
    />
  );
}

function pollErrorMessage(
  failure: ChannelAuthorizationError,
  purpose: Purpose,
  status: "invalid" | "pending" | ChannelAuthorizationStatus
): string {
  const base = channelFailureMessage(failure, purpose);

  if (status === "invalid") {
    return `${base} Start a new request to continue.`;
  }

  return base;
}

interface PollOutcome {
  readonly done: boolean;
  readonly delay: number;
  readonly failures: number;
}

interface PollStatusSetters {
  readonly setError: (error: string | undefined) => void;
  readonly setStatus: (status: ChannelAuthorizationStatus) => void;
}

interface PollFailureOptions extends PollStatusSetters {
  readonly expiresAtMs: number;
  readonly failure: ChannelAuthorizationError;
  readonly failures: number;
  readonly now: number;
  readonly purpose: Purpose;
}

interface PollTickOptions extends PollStatusSetters {
  readonly challengeId: string;
  readonly expiresAtMs: number;
  readonly purpose: Purpose;
}

interface PollOutcomeOptions extends PollStatusSetters {
  readonly expiresAtMs: number;
  readonly failures: number;
  readonly now: number;
  readonly purpose: Purpose;
  readonly result: Result.Result<
    { readonly status: ChannelAuthorizationStatus },
    ChannelAuthorizationError
  >;
}

interface PendingPollOptions extends PollStatusSetters {
  readonly challenge: Challenge | typeof deviceBoundSchema.Type;
  readonly controller: AbortController;
  readonly purpose: Purpose;
}

interface PendingAuthorizationEffectOptions extends PollStatusSetters {
  readonly challenge: Challenge | typeof deviceBoundSchema.Type;
  readonly purpose: Purpose;
  readonly status: ChannelAuthorizationStatus;
}

interface CompleteAuthorizationOptions {
  readonly action: ReturnType<typeof useAuthorizationRequest>;
  readonly callbackUrl: string;
  readonly challenge: Challenge | typeof deviceBoundSchema.Type;
  readonly onRestart: () => void;
  readonly purpose: Purpose;
  readonly router: ReturnType<typeof useRouter>;
  readonly setStatus: (status: ChannelAuthorizationStatus) => void;
  readonly status: ChannelAuthorizationStatus;
}

function handlePollSuccess(
  status: ChannelAuthorizationStatus,
  setters: PollStatusSetters
) {
  setters.setError(undefined);

  if (status !== "pending") {
    setters.setStatus(status);

    return { done: true, delay: 0, failures: 0 } satisfies PollOutcome;
  }

  return { done: false, delay: 2000, failures: 0 } satisfies PollOutcome;
}

function handlePollFailure(options: PollFailureOptions) {
  const next = channelPollFailure(
    options.failure,
    options.failures,
    options.now,
    options.expiresAtMs
  );

  options.setError(
    pollErrorMessage(options.failure, options.purpose, next.status)
  );

  if (next.status !== "pending") {
    options.setStatus(next.status);

    return {
      done: true,
      delay: 0,
      failures: next.failures,
    } satisfies PollOutcome;
  }

  return {
    done: false,
    delay: next.delay,
    failures: next.failures,
  } satisfies PollOutcome;
}

function createPollTick(options: PollTickOptions) {
  let failures = 0;

  const tick: Effect.Effect<void> = Effect.suspend(() =>
    Effect.gen(pollTickBody)
  );

  function* pollTickBody() {
    if ((yield* Clock.currentTimeMillis) >= options.expiresAtMs) {
      options.setStatus("expired");

      return;
    }

    const result = yield* checkChannelAuthorization(options.challengeId).pipe(
      Effect.result
    );

    const now = yield* Clock.currentTimeMillis;

    const outcome = pollOutcome({
      expiresAtMs: options.expiresAtMs,
      failures,
      now,
      purpose: options.purpose,
      result,
      setError: options.setError,
      setStatus: options.setStatus,
    });

    if (outcome.done) {
      return;
    }

    failures = outcome.failures;
    yield* Effect.sleep(outcome.delay);
    yield* tick;
  }

  return Effect.gen(function* pollConfirmation() {
    yield* tick;
  });
}

function pollOutcome(options: PollOutcomeOptions) {
  if (Result.isSuccess(options.result)) {
    return handlePollSuccess(options.result.success.status, {
      setError: options.setError,
      setStatus: options.setStatus,
    });
  }

  return handlePollFailure({
    expiresAtMs: options.expiresAtMs,
    failure: options.result.failure,
    failures: options.failures,
    now: options.now,
    purpose: options.purpose,
    setError: options.setError,
    setStatus: options.setStatus,
  });
}

function scheduleExpiry(
  expiresAt: string,
  controller: AbortController,
  setStatus: (status: ChannelAuthorizationStatus) => void
) {
  const remaining = Math.max(0, Date.parse(expiresAt) - Date.now());

  return setTimeout(
    expireAuthorization(controller, setStatus),
    Math.min(remaining, 2_147_483_647)
  );
}

function expireAuthorization(
  controller: AbortController,
  setStatus: (status: ChannelAuthorizationStatus) => void
) {
  return () => {
    controller.abort();
    setStatus("expired");
  };
}

function startPendingPoll(options: PendingPollOptions) {
  const poll = createPollTick({
    challengeId: options.challenge.id,
    expiresAtMs: Date.parse(options.challenge.expiresAt),
    purpose: options.purpose,
    setError: options.setError,
    setStatus: options.setStatus,
  });

  void Effect.runPromise(poll, { signal: options.controller.signal }).catch(
    reportPollTransportError(options.controller, options.setError)
  );
}

function reportPollTransportError(
  controller: AbortController,
  setError: (error: string | undefined) => void
) {
  return () => {
    if (!controller.signal.aborted) {
      setError(channelHttpError(0).message);
    }
  };
}

function cleanupAuthorizationEffect(
  timer: ReturnType<typeof setTimeout>,
  controller: AbortController
) {
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

function pendingAuthorizationEffect(
  options: PendingAuthorizationEffectOptions
) {
  return () => {
    if (options.status !== "pending" && options.status !== "confirmed") {
      return undefined;
    }

    const controller = new AbortController();

    const timer = scheduleExpiry(
      options.challenge.expiresAt,
      controller,
      options.setStatus
    );

    if (options.status === "pending") {
      startPendingPoll({
        challenge: options.challenge,
        controller,
        purpose: options.purpose,
        setError: options.setError,
        setStatus: options.setStatus,
      });
    }

    return cleanupAuthorizationEffect(timer, controller);
  };
}

function createCompleteHandler(options: CompleteAuthorizationOptions) {
  return () => {
    completePendingAuthorization(options);
  };
}

function completePendingAuthorization(options: CompleteAuthorizationOptions) {
  if (options.status !== "confirmed") {
    return;
  }

  if (new Date() >= new Date(options.challenge.expiresAt)) {
    options.setStatus("expired");

    return;
  }

  options.action.run(
    completeChannelAuthorization(options.challenge.id),
    finishCompletedAuthorization({
      callbackUrl: options.callbackUrl,
      onRestart: options.onRestart,
      purpose: options.purpose,
      router: options.router,
    })
  );
}

function finishCompletedAuthorization(options: {
  readonly callbackUrl: string;
  readonly onRestart: () => void;
  readonly purpose: Purpose;
  readonly router: ReturnType<typeof useRouter>;
}) {
  return () => {
    if (options.purpose === "link") {
      options.onRestart();
    }

    options.router.replace(safeCallbackUrl(options.callbackUrl));
    options.router.refresh();
  };
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
  readonly purpose: Purpose;
  readonly onRestart: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ChannelAuthorizationStatus>("pending");
  const [error, setError] = useState<string>();
  const action = useAuthorizationRequest();

  useEffect(() => {
    return pendingAuthorizationEffect({
      challenge,
      purpose,
      setError,
      setStatus,
      status,
    })();
  }, [challenge, status, purpose]);

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
        onContinue={createCompleteHandler({
          action,
          callbackUrl,
          challenge,
          onRestart,
          purpose,
          router,
          setStatus,
          status,
        })}
        onRestart={onRestart}
      />
      <LinkUnauthorized
        purpose={purpose}
        error={action.error}
        callbackUrl={callbackUrl}
      />
    </div>
  );
}

function abortActiveRequest(active: { current: AbortController | undefined }) {
  return () => {
    active.current?.abort();
  };
}

function reportRequestTransportError(
  controller: AbortController,
  setError: (error: ChannelAuthorizationError | undefined) => void
) {
  return () => {
    if (!controller.signal.aborted) {
      setError(channelHttpError(0));
    }
  };
}

function finishAuthorizationRequest(
  controller: AbortController,
  active: { current: AbortController | undefined },
  setBusy: (busy: boolean) => void
) {
  return () => {
    if (!controller.signal.aborted) {
      active.current = undefined;
      setBusy(false);
    }
  };
}

function authorizationMatchHandlers<A>(
  setError: (error: ChannelAuthorizationError | undefined) => void,
  onSuccess: (value: A) => void
) {
  return {
    onFailure: (failure: ChannelAuthorizationError) => {
      setError(failure);
    },
    onSuccess,
  };
}

export function useAuthorizationRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChannelAuthorizationError>();
  const active = useRef<AbortController | undefined>(undefined);

  useEffect(() => abortActiveRequest(active), []);

  function run<A>(
    operation: Effect.Effect<A, ChannelAuthorizationError>,
    onSuccess: (value: A) => void
  ) {
    if (active.current) {
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    void Effect.runPromise(
      operation.pipe(
        Effect.match(authorizationMatchHandlers(setError, onSuccess))
      ),
      { signal: controller.signal }
    )
      .catch(reportRequestTransportError(controller, setError))
      .finally(finishAuthorizationRequest(controller, active, setBusy));
  }

  return { busy, error, run };
}

function createSignInAgainClick(
  callbackUrl: string,
  setBusy: (busy: boolean) => void,
  setFailed: (failed: boolean) => void
) {
  return () => {
    setBusy(true);
    setFailed(false);
    void Promise.allSettled([authClient.signOut()]).then(
      handleSignOutOutcome(callbackUrl, setBusy, setFailed)
    );
  };
}

function handleSignOutOutcome(
  callbackUrl: string,
  setBusy: (busy: boolean) => void,
  setFailed: (failed: boolean) => void
) {
  return ([outcome]: [
    PromiseSettledResult<{
      readonly data: { readonly success: boolean } | null;
      readonly error: {
        readonly status: number;
        readonly statusText: string;
      } | null;
    }>,
  ]) => {
    const destination = reauthenticationDestination(outcome, callbackUrl);

    if (destination) {
      window.location.assign(destination);

      return undefined;
    }

    setFailed(true);
    setBusy(false);

    return undefined;
  };
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
        onClick={createSignInAgainClick(callbackUrl, setBusy, setFailed)}
      >
        {busy ? "Signing out…" : "Sign in again"}
      </Button>
      <SignInAgainFailure failed={failed} />
    </div>
  );
}

function SignInAgainFailure({ failed }: { readonly failed: boolean }) {
  if (!failed) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertDescription>
        Unable to sign out. Check your connection and try again.
      </AlertDescription>
    </Alert>
  );
}

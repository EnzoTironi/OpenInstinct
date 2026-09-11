"use client";

import {
  accountOnlineWipeLimits,
  accountOnlineWipeNotWiped,
  accountOnlineWipeWipedHint,
} from "@shared/identity/account-privacy-limits";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button, buttonVariants } from "@web/components/ui/button";
import { Option, Schema } from "effect";
import { useState } from "react";

const wipeResponseSchema = Schema.Struct({
  status: Schema.optionalKey(Schema.String),
  wiped: Schema.optionalKey(Schema.Array(Schema.String)),
  notWiped: Schema.optionalKey(Schema.Array(Schema.String)),
  limits: Schema.optionalKey(Schema.String),
});

const decodeOption_wipeResponseSchema =
  Schema.decodeUnknownOption(wipeResponseSchema);

interface WipeHandlers {
  readonly setBusy: (value: boolean) => void;
  readonly setConfirming: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly setResultLimits: (value: string | null) => void;
  readonly setResultNotWiped: (value: readonly string[] | null) => void;
}

function wipeHttpErrorMessage(status: number, text: string): string {
  const trimmed = text.trim();

  if (trimmed) return trimmed;

  if (status === 401) return "Sign in to wipe personal memory.";

  return "Online wipe is unavailable. Try again.";
}

function resetWipeUi(handlers: WipeHandlers) {
  handlers.setBusy(false);
  handlers.setConfirming(false);
}

async function applyWipeSuccess(
  response: Response,
  handlers: WipeHandlers
): Promise<void> {
  const raw: unknown = await response.json();
  const decoded = decodeOption_wipeResponseSchema(raw);
  const body = Option.isSome(decoded) ? decoded.value : {};

  if (body.status && body.status !== "partial_online_wipe") {
    handlers.setError(
      "Unexpected wipe status. This is not full account deletion; reload Account."
    );
    resetWipeUi(handlers);

    return;
  }

  handlers.setResultLimits(body.limits ?? accountOnlineWipeLimits);
  handlers.setResultNotWiped(body.notWiped ?? [...accountOnlineWipeNotWiped]);
  window.location.assign("/sign-in?callbackUrl=%2Faccount");
}

async function runWipe(handlers: WipeHandlers): Promise<void> {
  handlers.setBusy(true);
  handlers.setError(null);

  try {
    const response = await fetch("/api/account/delete", { method: "POST" });

    if (!response.ok) {
      handlers.setError(
        wipeHttpErrorMessage(response.status, await response.text())
      );
      resetWipeUi(handlers);

      return;
    }

    await applyWipeSuccess(response, handlers);
  } catch {
    handlers.setError("Unable to reach the wipe API. Check your connection.");
    resetWipeUi(handlers);
  }
}

function WipeErrorAlert({ error }: { readonly error: string | null }) {
  if (!error) return null;

  return (
    <Alert variant="destructive">
      <AlertTitle>Wipe failed</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function WipeResultAlert({
  resultLimits,
  resultNotWiped,
}: {
  readonly resultLimits: string | null;
  readonly resultNotWiped: readonly string[] | null;
}) {
  if (!resultLimits) return null;

  const retained =
    resultNotWiped?.length && resultNotWiped.length > 0
      ? ` Still retained: ${resultNotWiped.join(", ")}.`
      : "";

  return (
    <Alert variant="information">
      <AlertTitle>partial_online_wipe</AlertTitle>
      <AlertDescription>
        {resultLimits}
        {retained}
      </AlertDescription>
    </Alert>
  );
}

function WipeConfirmActions({
  busy,
  onConfirm,
  onCancel,
}: {
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <Button disabled={busy} onClick={onConfirm} variant="destructive">
        {busy ? "Wiping…" : "Confirm partial online wipe"}
      </Button>
      <Button disabled={busy} onClick={onCancel} variant="ghost">
        Cancel
      </Button>
    </>
  );
}

function WipeActionButtons({
  busy,
  confirming,
  onStartConfirm,
  onConfirm,
  onCancel,
}: {
  readonly busy: boolean;
  readonly confirming: boolean;
  readonly onStartConfirm: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <a
        className={buttonVariants({ variant: "outline" })}
        download
        href="/api/account/export"
      >
        Download privacy export (JSON)
      </a>
      {confirming ? (
        <WipeConfirmActions
          busy={busy}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : (
        <Button disabled={busy} onClick={onStartConfirm} variant="destructive">
          Wipe personal memory online
        </Button>
      )}
    </div>
  );
}

export function AccountPrivacyWipeSection() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultLimits, setResultLimits] = useState<string | null>(null);

  const [resultNotWiped, setResultNotWiped] = useState<
    readonly string[] | null
  >(null);

  const handlers: WipeHandlers = {
    setBusy,
    setConfirming,
    setError,
    setResultLimits,
    setResultNotWiped,
  };

  return (
    <section
      aria-labelledby="privacy-wipe-heading"
      className="space-y-4 rounded-xl border border-border/60 p-4 sm:p-6"
      id="privacy"
    >
      <div className="space-y-2">
        <h2 id="privacy-wipe-heading" className="type-section-title">
          Privacy export and online wipe
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          Same honesty as the API: this is a{" "}
          <span className="text-foreground">partial online wipe</span> of
          personal memory plus browser sessions — not full account erasure.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Not full account deletion</AlertTitle>
        <AlertDescription>{accountOnlineWipeLimits}</AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <h3 className="type-supporting-body font-medium">Wiped online</h3>
          <ul className="list-disc space-y-1 pl-5 type-caption text-muted-foreground">
            {accountOnlineWipeWipedHint.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="type-supporting-body font-medium">Not wiped</h3>
          <ul className="list-disc space-y-1 pl-5 type-caption text-muted-foreground">
            {accountOnlineWipeNotWiped.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <WipeErrorAlert error={error} />
      <WipeResultAlert
        resultLimits={resultLimits}
        resultNotWiped={resultNotWiped}
      />

      <WipeActionButtons
        busy={busy}
        confirming={confirming}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void runWipe(handlers);
        }}
        onStartConfirm={() => {
          setConfirming(true);
          setError(null);
        }}
      />
    </section>
  );
}

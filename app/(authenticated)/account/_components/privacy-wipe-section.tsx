"use client";

import { useState } from "react";
import { Option, Schema } from "effect";
import {
  accountOnlineWipeLimits,
  accountOnlineWipeNotWiped,
  accountOnlineWipeWipedHint,
} from "@shared/identity/account-privacy-limits";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button, buttonVariants } from "@web/components/ui/button";

const wipeResponseSchema = Schema.Struct({
  status: Schema.optionalKey(Schema.String),
  wiped: Schema.optionalKey(Schema.Array(Schema.String)),
  notWiped: Schema.optionalKey(Schema.Array(Schema.String)),
  limits: Schema.optionalKey(Schema.String),
});

export function AccountPrivacyWipeSection() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultLimits, setResultLimits] = useState<string | null>(null);
  const [resultNotWiped, setResultNotWiped] = useState<
    readonly string[] | null
  >(null);

  async function runWipe() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/delete", { method: "POST" });
      if (!response.ok) {
        const text = await response.text();
        setError(
          text.trim() ||
            (response.status === 401
              ? "Sign in to wipe personal memory."
              : "Online wipe is unavailable. Try again.")
        );
        setBusy(false);
        setConfirming(false);
        return;
      }
      const raw: unknown = await response.json();
      const decoded = Schema.decodeUnknownOption(wipeResponseSchema)(raw);
      const body = Option.isSome(decoded) ? decoded.value : {};
      if (body.status && body.status !== "partial_online_wipe") {
        setError(
          "Unexpected wipe status. This is not full account deletion; reload Account."
        );
        setBusy(false);
        setConfirming(false);
        return;
      }
      setResultLimits(body.limits ?? accountOnlineWipeLimits);
      setResultNotWiped(body.notWiped ?? [...accountOnlineWipeNotWiped]);
      // Sessions are invalidated; send the user to sign-in.
      window.location.assign("/sign-in?callbackUrl=%2Faccount");
    } catch {
      setError("Unable to reach the wipe API. Check your connection.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section
      aria-labelledby="privacy-wipe-heading"
      className="space-y-4 rounded-xl border border-border/60 p-4 sm:p-6"
      id="privacy"
    >
      <div className="space-y-2">
        <h2 id="privacy-wipe-heading" className="type-section-title">
          Seus dados e sua privacidade
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          Exporte seus dados ou apague a memória pessoal salva. Essa ação também
          encerra suas sessões no navegador.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>O que esta ação remove</AlertTitle>
        <AlertDescription>{accountOnlineWipeLimits}</AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <h3 className="type-supporting-body font-medium">
            O que será apagado
          </h3>
          <ul className="list-disc space-y-1 pl-5 type-caption text-muted-foreground">
            {accountOnlineWipeWipedHint.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="type-supporting-body font-medium">
            O que será mantido
          </h3>
          <ul className="list-disc space-y-1 pl-5 type-caption text-muted-foreground">
            {accountOnlineWipeNotWiped.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível apagar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {resultLimits ? (
        <Alert variant="information">
          <AlertTitle>Exclusão parcial concluída</AlertTitle>
          <AlertDescription>
            {resultLimits}
            {resultNotWiped?.length
              ? ` Still retained: ${resultNotWiped.join(", ")}.`
              : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <a
          className={buttonVariants({ variant: "outline" })}
          download
          href="/api/account/export"
        >
          Exportar meus dados (JSON)
        </a>
        {!confirming ? (
          <Button
            disabled={busy}
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            variant="destructive"
          >
            Apagar memória pessoal
          </Button>
        ) : (
          <>
            <Button
              disabled={busy}
              onClick={() => {
                void runWipe();
              }}
              variant="destructive"
            >
              {busy ? "Apagando…" : "Confirmar exclusão parcial"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
              variant="ghost"
            >
              Cancelar
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

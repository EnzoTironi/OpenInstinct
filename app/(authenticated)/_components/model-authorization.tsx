"use client";
import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";

export function ModelAuthorization({
  connected,
}: {
  readonly connected: boolean;
}) {
  const { t } = useI18n();
  const utils = api.useUtils();
  const start = api.modelConnections.start.useMutation();
  const { mutateAsync: poll } = api.modelConnections.poll.useMutation();
  const disconnect = api.modelConnections.disconnect.useMutation();
  const [challenge, setChallenge] = useState<Awaited<
    ReturnType<typeof start.mutateAsync>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!challenge) return undefined;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (Date.now() >= Date.parse(challenge.expiresAt)) {
        setChallenge(null);
        setFailed(true);
        return;
      }
      try {
        const result = await poll({ id: challenge.id });
        if (disposed) return;
        if (result.status === "pending")
          timer = setTimeout(() => void check(), result.interval * 1000);
        else {
          setChallenge(null);
          setFailed(result.status === "failed");
          if (result.status === "connected")
            await utils.modelConnections.read.invalidate();
        }
      } catch {
        if (!disposed) {
          setChallenge(null);
          setFailed(true);
        }
      }
    };
    timer = setTimeout(() => void check(), challenge.interval * 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [challenge, poll, utils]);

  return (
    <>
      {!challenge && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(["chatgpt", "grok"] as const).map((provider) => (
            <Button
              key={provider}
              variant="secondary"
              disabled={start.isPending}
              onClick={() => {
                setFailed(false);
                void start
                  .mutateAsync({ provider })
                  .then(setChallenge)
                  .catch(() => {
                    setFailed(true);
                  });
              }}
            >
              {provider === "chatgpt" ? "ChatGPT" : "Grok"}
            </Button>
          ))}
          {connected && (
            <Button
              variant="ghost"
              disabled={disconnect.isPending}
              onClick={() => {
                void disconnect
                  .mutateAsync()
                  .then(() => utils.modelConnections.read.invalidate())
                  .catch(() => {
                    setFailed(true);
                  });
              }}
            >
              {t("Usar Zoen")}
            </Button>
          )}
        </div>
      )}
      {challenge && (
        <div className="mt-4 flex flex-col items-start gap-3" data-private>
          <p className="type-caption">
            {t("Confirme este código na sua conta:")}
          </p>
          <code className="type-section-title tracking-widest select-all">
            {challenge.userCode}
          </code>
          <a
            className="inline-flex items-center gap-2 type-label underline"
            href={challenge.verificationUri}
            target="_blank"
            rel="noreferrer"
          >
            {t("Autorizar conexão")} <ExternalLinkIcon size={16} />
          </a>
          <output className="type-caption text-muted-foreground">
            {t("Aguardando sua autorização…")}
          </output>
          <Button
            variant="ghost"
            onClick={() => {
              setChallenge(null);
            }}
          >
            {t("Fechar")}
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert" className="mt-3 type-caption">
          {t(
            "Não foi possível conectar. Verifique o acesso aos modelos na sua conta e tente novamente."
          )}
        </p>
      )}
    </>
  );
}

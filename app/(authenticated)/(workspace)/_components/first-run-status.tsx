"use client";

import type { createTranslator } from "@web/i18n/translate";
import { useI18n } from "@web/i18n/context";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";

interface LinkedChannelSummary {
  readonly channel: "telegram" | "kapso";
  readonly senderId: string;
}

function channelLabel(channel: LinkedChannelSummary["channel"]) {
  return channel === "telegram" ? "Telegram" : "WhatsApp";
}

export function describeLinkedChannels(
  identities: readonly LinkedChannelSummary[],
  t: ReturnType<typeof createTranslator>
) {
  if (identities.length === 0) return t("Nenhum mensageiro conectado ainda.");
  const labels: string[] = [];
  for (const identity of identities) {
    const label = channelLabel(identity.channel);
    if (!labels.includes(label)) labels.push(label);
  }
  const first = labels.at(0);
  if (first !== undefined && labels.length === 1) {
    return t("{channel} conectado à sua conta.", { channel: first });
  }
  return t("{channels} conectados à sua conta.", {
    channels: labels.join(t(" e ")),
  });
}

export function FirstRunStatus({
  identities,
  welcome,
}: {
  readonly identities: readonly LinkedChannelSummary[];
  readonly welcome: boolean;
}) {
  const { t } = useI18n();
  const linked = identities.length > 0;
  if (!welcome && linked) return null;
  if (linked) {
    return (
      <Alert>
        <AlertTitle>{t("Tudo pronto.")}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {describeLinkedChannels(identities, t)}{" "}
            {t("Fale com o Zoen por lá ou comece por aqui.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              nativeButton={false}
              render={<Link href="/chat" />}
              size="sm"
            >
              {t("Começar uma conversa")}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/connections?messengers=1" />}
              size="sm"
              variant="outline"
            >
              {t("Conexões")}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>{t("Leve o Zoen com você.")}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {t("Conecte o Telegram ou o WhatsApp para conversar onde preferir.")}
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/connections?messengers=1" />}
          size="sm"
        >
          {t("Conectar um mensageiro")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

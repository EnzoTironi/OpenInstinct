"use client";

import { useState } from "react";
import { useI18n } from "@web/i18n/context";
import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";
import { Button } from "@web/components/ui/button";
import { OnboardingFrame } from "@web/auth/onboarding/frame";
import styles from "@web/auth/onboarding/onboarding.module.css";

export function GetStartedPanel({
  whatsappUrl,
  telegramUrl,
  imessageUrl,
}: {
  readonly whatsappUrl: string | null;
  readonly telegramUrl: string | null;
  readonly imessageUrl: string | null;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const available = Boolean(whatsappUrl ?? telegramUrl ?? imessageUrl);
  return (
    <OnboardingFrame step={step} onStep={setStep}>
      {!available && (
        <p className="type-supporting-body mb-5 text-center text-muted-foreground">
          {t(
            "A conversa ainda não está disponível por aqui. Volte em breve para conhecer seu Zoen."
          )}
        </p>
      )}
      {available ? (
        <div className="flex flex-col gap-3">
          {[
            { label: "WhatsApp", url: whatsappUrl },
            { label: "Telegram", url: telegramUrl },
            { label: "iMessage", url: imessageUrl },
          ].map(
            ({ label, url }) =>
              url && (
                <Button
                  key={label}
                  nativeButton={false}
                  render={
                    <a
                      aria-label={t("Abrir {name}", { name: label })}
                      href={url}
                    />
                  }
                  size="lg"
                >
                  <MessageCircleIcon aria-hidden="true" /> {t("Abrir")} {label}
                </Button>
              )
          )}
        </div>
      ) : (
        <Button
          nativeButton={false}
          render={<Link href="/welcome" />}
          size="lg"
          className="w-full"
        >
          {t("Conhecer o Zoen")}
        </Button>
      )}
      <p className={styles.note}>
        {t("Já usa o Zoen?")}{" "}
        <Link className="underline underline-offset-4" href="/sign-in">
          {t("Acessar minha conta")}
        </Link>
      </p>
    </OnboardingFrame>
  );
}

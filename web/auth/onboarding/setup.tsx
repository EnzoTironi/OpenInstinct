"use client";

import { useState } from "react";
import type { Effect } from "effect";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  CheckIcon,
  HomeIcon,
} from "lucide-react";
import type { listUserWorkspaces } from "../../../server/workspaces/directory";
import type { readLinkedChannelIdentities } from "../../../server/accounts/controls";
import type { channelProviderSchema } from "@shared/identity/channel-auth";
import { ChannelAuthForm } from "@web/auth/channel/form";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@web/i18n/context";
import { workspaceHref } from "@web/workspaces/navigation";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { OnboardingFrame } from "./frame";
import styles from "./onboarding.module.css";

export function OnboardingSetup({
  workspaces,
  identities,
  available,
  callbackUrl,
}: {
  readonly workspaces: Effect.Success<ReturnType<typeof listUserWorkspaces>>;
  readonly identities: Effect.Success<
    ReturnType<typeof readLinkedChannelIdentities>
  >;
  readonly available: readonly (typeof channelProviderSchema.Type)[];
  readonly callbackUrl: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(identities.length ? 2 : 1);
  const [linked, setLinked] = useState(
    identities.map((identity) => identity.channel)
  );
  const [selected, setSelected] = useState(
    workspaces.find((space) => !space.organizationId)?.id ?? workspaces[0]?.id
  );
  return (
    <OnboardingFrame step={step} onStep={setStep} signedIn>
      {step === 1 ? (
        <>
          <ChannelAuthForm
            purpose="link"
            callbackUrl="/onboarding"
            onComplete={(channel) => {
              setLinked((previous) => [...new Set([...previous, channel])]);
              setStep(2);
            }}
          >
            {({ start, busy }) => (
              <div className={styles.choiceList}>
                {available.map((channel) => {
                  const connected = linked.includes(channel);
                  const name = channel === "telegram" ? "Telegram" : "WhatsApp";
                  return (
                    <Button
                      key={channel}
                      variant="surface"
                      size="lg"
                      disabled={busy || connected}
                      onClick={() => {
                        start(channel);
                      }}
                    >
                      <Image
                        alt=""
                        src={`/marketing/${channel === "kapso" ? "whatsapp" : "telegram"}.avif`}
                        width={30}
                        height={30}
                      />
                      <span className={styles.choiceText}>{name}</span>
                      {connected ? (
                        <CheckIcon
                          className={styles.connected}
                          aria-label={t("Conectado")}
                        />
                      ) : (
                        <ArrowRightIcon aria-hidden="true" />
                      )}
                    </Button>
                  );
                })}
                {!available.length && (
                  <p className={styles.note}>
                    {t("Você já pode conversar com o Zoen pelo app.")}
                  </p>
                )}
              </div>
            )}
          </ChannelAuthForm>
          <Button
            className={styles.skip}
            variant="quiet"
            onClick={() => {
              setStep(2);
            }}
          >
            {t("Conectar depois")}
          </Button>
        </>
      ) : (
        <>
          <fieldset
            className={styles.choiceList}
            aria-label={t("Escolha seu espaço")}
          >
            {workspaces.map((space) => (
              <Button
                key={space.id}
                variant="surface"
                size="lg"
                aria-pressed={selected === space.id}
                onClick={() => {
                  setSelected(space.id);
                }}
              >
                {space.organizationId ? (
                  <BriefcaseBusinessIcon aria-hidden="true" />
                ) : (
                  <HomeIcon aria-hidden="true" />
                )}
                <span className={styles.choiceText}>
                  {space.organizationId ? space.name : t("Pessoal")}
                  <small>
                    {space.organizationId
                      ? t("Com sua equipe")
                      : t("Só você e seu Zoen")}
                  </small>
                </span>
                {selected === space.id && (
                  <CheckIcon className={styles.connected} aria-hidden="true" />
                )}
              </Button>
            ))}
          </fieldset>
          <Button
            className={styles.continue}
            disabled={!selected}
            onClick={() => {
              const space = workspaces.find((item) => item.id === selected);
              if (space)
                router.push(
                  workspaceHref(
                    safeCallbackUrl(callbackUrl),
                    space.organizationId ? space.id : null
                  )
                );
            }}
          >
            {t("Entrar no meu espaço")} <ArrowRightIcon aria-hidden="true" />
          </Button>
          <p className={styles.note}>
            {t("Você pode criar ou entrar em outras equipes pelo seu perfil.")}
          </p>
        </>
      )}
    </OnboardingFrame>
  );
}

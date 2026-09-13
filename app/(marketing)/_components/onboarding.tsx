"use client";

import { useI18n } from "@web/i18n/context";

import { createContext, useContext, useState, type ReactNode } from "react";
import Image from "next/image";
import { ArrowUpRightIcon, MessageCircleIcon, XIcon } from "lucide-react";
import type { Effect } from "effect";
import type { conversationDestinations } from "../../../server/channels/destination";
import { Button, type ButtonProps } from "@web/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@web/components/ui/dialog";
import styles from "./onboarding.module.css";

const channels = [
  { id: "whatsapp", label: "WhatsApp", image: "/marketing/whatsapp.avif" },
  { id: "telegram", label: "Telegram", image: "/marketing/telegram.avif" },
  { id: "imessage", label: "iMessage", image: null },
] as const;

const OnboardingContext = createContext<Effect.Success<
  typeof conversationDestinations
> | null>(null);

function ChannelIcon({
  channel,
}: {
  readonly channel: (typeof channels)[number];
}) {
  return channel.image ? (
    <Image alt="" height={44} src={channel.image} unoptimized width={44} />
  ) : (
    <span className={styles.imessageIcon}>
      <MessageCircleIcon aria-hidden="true" />
    </span>
  );
}

export function ConversationIcons() {
  const { t } = useI18n();
  const destinations = useContext(OnboardingContext);
  return (
    <nav aria-label={t("Escolha seu mensageiro")} className={styles.icons}>
      {channels.map((channel) => {
        const destination = destinations?.[channel.id];
        return destination ? (
          <Button
            aria-label={channel.label}
            className={styles.iconButton}
            key={channel.id}
            nativeButton={false}
            render={<a aria-label={channel.label} href={destination} />}
            size="icon"
          >
            <ChannelIcon channel={channel} />
          </Button>
        ) : (
          <Button
            aria-label={channel.label}
            className={styles.iconButton}
            disabled
            key={channel.id}
            size="icon"
          >
            <ChannelIcon channel={channel} />
          </Button>
        );
      })}
    </nav>
  );
}

export function OnboardingTrigger({
  children,
  ...props
}: Omit<ButtonProps, "render" | "nativeButton">) {
  return (
    <DialogTrigger render={<Button {...props} />}>{children}</DialogTrigger>
  );
}

export function OnboardingProvider({
  children,
  destinations,
}: {
  readonly children: ReactNode;
  readonly destinations: Effect.Success<typeof conversationDestinations>;
}) {
  const { t } = useI18n();
  const [unavailable, setUnavailable] = useState<
    (typeof channels)[number]["label"] | null
  >(null);

  return (
    <OnboardingContext value={destinations}>
      <Dialog
        onOpenChange={() => {
          setUnavailable(null);
        }}
      >
        {children}
        <DialogContent className={styles.sheet} showCloseButton={false}>
          <div aria-hidden="true" className={styles.handle} />
          <DialogTitle className="sr-only">
            {t("Começar uma conversa")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("Escolha seu mensageiro para conversar com o Zoen.")}
          </DialogDescription>
          <DialogClose
            aria-label={t("Fechar")}
            className={styles.close}
            render={<Button size="icon" variant="plain" />}
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
          <div className={styles.channels}>
            {channels.map((channel) => {
              const destination = destinations[channel.id];
              return (
                <Button
                  className={styles.channel}
                  key={channel.id}
                  nativeButton={!destination}
                  onClick={() => {
                    if (!destination) setUnavailable(channel.label);
                  }}
                  render={
                    destination ? (
                      <a aria-label={channel.label} href={destination} />
                    ) : undefined
                  }
                  size="lg"
                >
                  <ChannelIcon channel={channel} />
                  <span>{channel.label}</span>
                  <ArrowUpRightIcon aria-hidden="true" />
                </Button>
              );
            })}
          </div>
          {unavailable && (
            <output className={styles.status}>
              {unavailable}{" "}
              {t("ainda não está disponível por aqui. Volte em breve.")}
            </output>
          )}
        </DialogContent>
      </Dialog>
    </OnboardingContext>
  );
}

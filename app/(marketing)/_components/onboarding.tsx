"use client";

import { useI18n } from "@web/i18n/context";

import { createContext, useContext, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";
import type { Effect } from "effect";
import type { conversationDestinations } from "../../../server/channels/destination";
import { Button, type ButtonProps } from "@web/components/ui/button";
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
    <Button
      {...props}
      nativeButton={false}
      render={<Link href="/get-started" />}
    >
      {children}
    </Button>
  );
}

export function OnboardingProvider({
  children,
  destinations,
}: {
  readonly children: ReactNode;
  readonly destinations: Effect.Success<typeof conversationDestinations>;
}) {
  return <OnboardingContext value={destinations}>{children}</OnboardingContext>;
}

"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@web/components/ui/button";
import styles from "./marketing-landing.module.css";

const mockups = [
  {
    channel: "WhatsApp",
    image: "zoen-whatsapp",
    caption: "Um contrato guardado. Um prazo lembrado.",
    description:
      "Mockup de WhatsApp: o Zoen guarda um contrato e combina um lembrete antes do vencimento.",
  },
  {
    channel: "iMessage",
    image: "zoen-imessage",
    caption: "Um jantar combinado. Sem o vai e volta.",
    description:
      "Mockup de iMessage: o Zoen encontra um horário com o Zoen da Ana e confirma o jantar.",
  },
  {
    channel: "Telegram",
    image: "zoen-telegram",
    caption: "Os pedidos de amanhã. Tudo no seu horário.",
    description:
      "Mockup de Telegram: o Zoen organiza três pedidos e prepara a lista do dia seguinte.",
  },
] as const;

export function ChatPreview() {
  const [active, setActive] = useState<(typeof mockups)[number]>(mockups[0]);
  return (
    <div className={styles.chatDemo}>
      <fieldset
        aria-label="Canal da demonstração"
        className={styles.channelChoices}
      >
        {mockups.map((mockup) => (
          <Button
            aria-pressed={active === mockup}
            className={styles.channelChoice}
            key={mockup.channel}
            onClick={() => {
              setActive(mockup);
            }}
            variant="plain"
          >
            {mockup.channel}
          </Button>
        ))}
      </fieldset>
      <figure className={styles.mockupStage}>
        <Image
          alt={active.description}
          height={1536}
          key={active.image}
          sizes="(max-width: 760px) 115vw, 560px"
          src={`/marketing/${active.image}.webp`}
          unoptimized
          width={1024}
        />
        <figcaption aria-live="polite">{active.caption}</figcaption>
      </figure>
    </div>
  );
}

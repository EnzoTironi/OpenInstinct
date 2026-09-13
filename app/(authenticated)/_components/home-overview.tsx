"use client";

import { useI18n } from "@web/i18n/context";
import {
  LayoutGridIcon,
  MailIcon,
  MessageCircleIcon,
  PuzzleIcon,
  ZapIcon,
} from "lucide-react";
import Image from "next/image";
import { PanelLink } from "./panel-link";
import { HomeGreeting } from "./home-greeting";
import styles from "./home.module.css";

const destinations = [
  {
    href: "/reminders",
    label: "Automações",
    caption: "Deixe acontecer",
    icon: ZapIcon,
  },
  {
    href: "/connections",
    label: "Conexões",
    caption: "Tudo junto",
    icon: PuzzleIcon,
  },
  { href: "/recipes", label: "Receitas", icon: LayoutGridIcon },
  { href: "/mail", label: "E-mail", icon: MailIcon },
  { href: "/chat", label: "Conversa", icon: MessageCircleIcon },
] as const;

export function HomeOverview() {
  const { t } = useI18n();
  return (
    <>
      <div className={styles.scene}>
        <Image
          alt={t("O mascote Zoen correndo para cuidar do seu dia")}
          fill
          loading="eager"
          sizes="(max-width: 540px) 95vw, 500px"
          src="/marketing/zoen-running.jpg"
          unoptimized
        />
        <span className={styles.sceneLabel}>
          {t("SEU DIA, COM MAIS LEVEZA")}
        </span>
      </div>
      <div className={styles.homeContent}>
        <HomeGreeting />
        <p className={styles.subtitle}>
          {t("O que está na sua cabeça?")}
          <br />
          {t("Pode deixar comigo.")}
        </p>
        <nav aria-label={t("Seu Zoen")} className={styles.tiles}>
          {destinations.map(({ href, label, icon: Icon, ...item }) => (
            <PanelLink className={styles.tile} href={href} key={href}>
              <Icon aria-hidden="true" />
              <span>{t(label)}</span>
              {"caption" in item && <small>{t(item.caption)}</small>}
            </PanelLink>
          ))}
        </nav>
      </div>
    </>
  );
}

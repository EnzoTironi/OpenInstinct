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
  return (
    <>
      <div className={styles.scene}>
        <Image
          alt="O mascote Zoen correndo para cuidar do seu dia"
          fill
          loading="eager"
          sizes="(max-width: 540px) 95vw, 500px"
          src="/marketing/zoen-running.jpg"
          unoptimized
        />
        <span className={styles.sceneLabel}>SEU DIA, COM MAIS LEVEZA</span>
      </div>
      <div className={styles.homeContent}>
        <HomeGreeting />
        <p className={styles.subtitle}>
          O que está na sua cabeça?
          <br />
          Pode deixar comigo.
        </p>
        <nav aria-label="Seu Zoen" className={styles.tiles}>
          {destinations.map(({ href, label, icon: Icon, ...item }) => (
            <PanelLink className={styles.tile} href={href} key={href}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {"caption" in item && <small>{item.caption}</small>}
            </PanelLink>
          ))}
        </nav>
      </div>
    </>
  );
}

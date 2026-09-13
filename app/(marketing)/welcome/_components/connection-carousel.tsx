"use client";

import { useI18n } from "@web/i18n/context";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  FolderOpenIcon,
  MailIcon,
  PauseIcon,
  PlayIcon,
  ShoppingBagIcon,
  Building2Icon,
  NotebookPenIcon,
} from "lucide-react";
import { Button } from "@web/components/ui/button";
import styles from "./marketing-landing.module.css";

const examples = [
  {
    label: "Agenda",
    service: "Google Calendar",
    icon: CalendarDaysIcon,
    title: "Um espaço para o que importa.",
    request: "Conecta minha agenda e encontra uma hora livre amanhã?",
    reply:
      "Conecte sua conta por aqui. Eu confiro seus horários e preparo a reserva.",
  },
  {
    label: "Arquivos",
    service: "Google Drive",
    icon: FolderOpenIcon,
    title: "O que você precisa, à mão.",
    request: "Junta os contratos que vencem este mês.",
    reply:
      "Conecte seu Drive. Vou organizar os prazos e te mostrar o que precisa de atenção.",
  },
  {
    label: "E-mail",
    service: "Gmail",
    icon: MailIcon,
    title: "A mensagem certa, na hora certa.",
    request: "Me avisa quando chegar a proposta da Ana.",
    reply:
      "Conecte seu e-mail. Eu acompanho essa conversa e aviso quando houver novidade.",
  },
  {
    label: "Sua loja",
    service: "Shopify",
    icon: ShoppingBagIcon,
    title: "Sua loja também pode conversar.",
    request: "Todo fim de dia, me conta como foram as vendas.",
    reply: "Conecte sua loja. Vou preparar um resumo e mandar por aqui.",
  },
  {
    label: "Seu sistema",
    service: "O sistema da sua empresa",
    icon: Building2Icon,
    title: "Até aquela ferramenta só sua.",
    request: "Quero acompanhar os pedidos do meu sistema por aqui.",
    reply:
      "Vou preparar essa conexão. Você escolhe o acesso e eu cuido dos detalhes.",
  },
  {
    label: "Estudos",
    service: "Notion",
    icon: NotebookPenIcon,
    title: "Uma coisa a menos na cabeça.",
    request: "Conecta meu Notion e me ajuda com as entregas da faculdade.",
    reply:
      "Conecte seu espaço. Eu junto as tarefas e organizo o que vem primeiro.",
  },
] as const;

export function ConnectionCarousel() {
  const { t } = useI18n();
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reduceMotion = useReducedMotion();
  const active = examples[current] ?? examples[0];
  const Icon = active.icon;
  useEffect(() => {
    if (reduceMotion || !playing) return undefined;
    const timer = window.setInterval(() => {
      setCurrent((index) => (index + 1) % examples.length);
    }, 6500);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing, reduceMotion]);

  return (
    <section
      aria-label={t("Exemplos de conexões")}
      aria-roledescription={t("carrossel")}
      className={styles.connectionCarousel}
    >
      <div
        aria-live={playing && !reduceMotion ? "off" : "polite"}
        className={styles.carouselStage}
      >
        <article
          aria-label={t("{current} de {total}: {label}", {
            current: current + 1,
            total: examples.length,
            label: t(active.label),
          })}
          aria-roledescription={t("slide")}
          className={styles.connectionSlide}
          key={active.label}
        >
          <div className={styles.connectionService}>
            <Icon aria-hidden="true" />
            <span>{active.service}</span>
          </div>
          <h3>{t(active.title)}</h3>
          <blockquote>“{t(active.request)}”</blockquote>
          <div className={styles.connectionAnswer}>
            <span>Zoen</span>
            <p>{t(active.reply)}</p>
          </div>
        </article>
      </div>
      <div className={styles.carouselControls}>
        <Button
          aria-label={t("Exemplo anterior")}
          className={styles.carouselArrow}
          onClick={() => {
            setPlaying(false);
            setCurrent(
              (index) => (index - 1 + examples.length) % examples.length
            );
          }}
          size="icon"
          variant="plain"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <fieldset
          aria-label={t("Escolher exemplo")}
          className={styles.carouselDots}
        >
          {examples.map((example, index) => (
            <Button
              aria-label={t("Mostrar exemplo: {name}", {
                name: t(example.label),
              })}
              aria-pressed={current === index}
              className={styles.carouselDot}
              key={example.label}
              onClick={() => {
                setPlaying(false);
                setCurrent(index);
              }}
              size="icon-sm"
              variant="plain"
            >
              <span aria-hidden="true" />
            </Button>
          ))}
        </fieldset>
        <Button
          aria-label={t("Próximo exemplo")}
          className={styles.carouselArrow}
          onClick={() => {
            setPlaying(false);
            setCurrent((index) => (index + 1) % examples.length);
          }}
          size="icon"
          variant="plain"
        >
          <ArrowRightIcon aria-hidden="true" />
        </Button>
        {!reduceMotion && (
          <Button
            aria-label={
              playing ? t("Pausar carrossel") : t("Reproduzir carrossel")
            }
            className={styles.carouselArrow}
            onClick={() => {
              setPlaying((value) => !value);
            }}
            size="icon"
            variant="plain"
          >
            {playing ? (
              <PauseIcon aria-hidden="true" />
            ) : (
              <PlayIcon aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
    </section>
  );
}

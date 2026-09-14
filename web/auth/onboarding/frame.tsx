"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@web/i18n/context";
import { cn } from "@web/components/class-names";
import styles from "./onboarding.module.css";

const steps = [
  {
    label: "Seu Zoen",
    title: "Mais espaço para viver.",
    description:
      "As ideias, os planos, o que não pode ficar para depois. Pode deixar comigo.",
    image: "/marketing/zoen-running.jpg",
    eyebrow: "SEU DIA, COM MAIS LEVEZA",
  },
  {
    label: "Conexões",
    title: "Tudo começa com um oi.",
    description: "Seu Zoen, no mensageiro que já faz parte do seu dia.",
    image: "/marketing/panel/zoen-integration.png",
    eyebrow: "PERTO DE VOCÊ",
  },
  {
    label: "Seu espaço",
    title: "Uma conta. Seus mundos.",
    description:
      "Um espaço só seu. Outros para suas equipes. Você escolhe onde estar.",
    image: "/marketing/panel/zoen-together.jpg",
    eyebrow: "CADA COISA NO SEU LUGAR",
  },
] as const;

export function OnboardingFrame({
  step,
  onStep,
  signedIn = false,
  children,
}: {
  readonly step: number;
  readonly onStep: (step: number) => void;
  readonly signedIn?: boolean;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  const start = useRef<{ x: number; y: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = steps[step] ?? steps[0];
  const first = signedIn ? 1 : 0;
  function navigate(next: number) {
    onStep(Math.max(first, Math.min(steps.length - 1, next)));
    heading.current?.focus({ preventScroll: true });
  }
  return (
    <section
      className={styles.card}
      aria-label={t("Conheça seu Zoen")}
      aria-roledescription={t("Carrossel")}
    >
      <div
        className={styles.story}
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        onPointerUp={(event) => {
          const origin = start.current;
          start.current = null;
          if (!origin) return;
          const dx = event.clientX - origin.x;
          if (
            Math.abs(dx) > 55 &&
            Math.abs(dx) > Math.abs(event.clientY - origin.y) * 1.5
          )
            navigate(step + (dx < 0 ? 1 : -1));
        }}
      >
        <div className={styles.scene} aria-hidden="true">
          {steps.map((item, index) => (
            <Image
              key={item.label}
              alt=""
              src={item.image}
              fill
              loading="eager"
              unoptimized
              sizes="(max-width: 540px) 100vw, 480px"
              draggable={false}
              className={cn(
                styles.sceneImage,
                index === step && styles.sceneActive,
                index === 1 && styles.cutout
              )}
            />
          ))}
          <span className={styles.eyebrow}>{t(current.eyebrow)}</span>
        </div>
        <div className={styles.copy} aria-live="polite" aria-atomic="true">
          <h1
            className={cn("type-signal", styles.title)}
            ref={heading}
            tabIndex={-1}
          >
            {t(current.title)}
          </h1>
          <p className={cn("type-supporting-body", styles.description)}>
            {t(current.description)}
          </p>
        </div>
      </div>
      <nav className={styles.progress} aria-label={t("Etapas do onboarding")}>
        <Button
          variant="plain"
          size="icon-lg"
          disabled={step <= first}
          aria-label={t("Etapa anterior")}
          onClick={() => {
            navigate(step - 1);
          }}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <div className={styles.dots}>
          {steps.map((item, index) => (
            <button
              key={item.label}
              type="button"
              className={styles.step}
              aria-label={t(item.label)}
              aria-current={index === step ? "step" : undefined}
              disabled={signedIn && index === 0}
              onClick={() => {
                navigate(index);
              }}
            >
              {signedIn && index === 0 ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <span />
              )}
            </button>
          ))}
        </div>
        <Button
          variant="plain"
          size="icon-lg"
          disabled={step === 2}
          aria-label={t("Próxima etapa")}
          onClick={() => {
            navigate(step + 1);
          }}
        >
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </nav>
      <div className={styles.actions}>{children}</div>
    </section>
  );
}

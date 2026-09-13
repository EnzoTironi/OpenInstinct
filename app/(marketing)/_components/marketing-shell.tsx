"use client";

import { LanguagePicker } from "@web/i18n/language-picker";

import { useI18n } from "@web/i18n/context";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@web/components/ui/logo";
import { Button } from "@web/components/ui/button";
import { Separator } from "@web/components/ui/separator";
import { cn } from "@web/components/class-names";
import { companionPublicOrigin } from "../public-origin";
import styles from "./marketing-shell.module.css";
import { OnboardingTrigger } from "./onboarding";

const nav = [
  { href: "/welcome", label: "Produto" },
  { href: "/docs", label: "Guia" },
] as const;

export function MarketingFrame({
  children,
  className,
  as: Tag = "div",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "div" | "section" | "header" | "footer";
}) {
  return (
    <Tag className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>
      {children}
    </Tag>
  );
}

export function MarketingShell({
  children,
  active,
}: {
  readonly children: ReactNode;
  readonly active?: "product" | "docs";
}) {
  const { t, locale } = useI18n();
  return (
    <div
      className={cn(
        "flex min-h-svh flex-col bg-background text-foreground",
        active === "product" && styles.landingShell
      )}
      lang={locale}
    >
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <MarketingFrame className="flex h-16 items-center justify-between gap-4">
          <Link className="flex items-center gap-2 type-label" href="/welcome">
            <Logo />
            <span>Zoen</span>
          </Link>
          <nav
            aria-label={t("Marketing")}
            className="hidden items-center gap-1 md:flex"
          >
            {nav.map((item) => (
              <NavItem active={active} item={item} key={item.href} />
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              className="hidden sm:inline-flex"
              nativeButton={false}
              render={<Link href="/sign-in" />}
              size="sm"
              variant="quiet"
            >
              {t("Entrar")}
            </Button>
            <OnboardingTrigger size="sm">{t("Começar")}</OnboardingTrigger>
          </div>
        </MarketingFrame>
        <MarketingFrame className="flex items-center gap-1 pb-3 md:hidden">
          <nav
            aria-label={t("Marketing no celular")}
            className="flex flex-wrap items-center gap-1"
          >
            {nav.map((item) => (
              <NavItem active={active} item={item} key={item.href} />
            ))}
            <Button
              nativeButton={false}
              render={<Link href="/sign-in" />}
              size="sm"
              variant="quiet"
            >
              {t("Entrar")}
            </Button>
          </nav>
        </MarketingFrame>
      </header>
      <div className="flex-1">{children}</div>
      <footer>
        <Separator />
        <MarketingFrame className="flex flex-col gap-8 py-12 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex max-w-sm flex-col gap-2">
            <Link
              className="flex items-center gap-2 type-label"
              href="/welcome"
            >
              <Logo />
              <span>Zoen</span>
            </Link>
            <p className="type-caption text-muted-foreground">
              {t("Sua vida tem companhia. Conheça o")}{" "}
              <a
                className="underline-offset-4 hover:text-foreground hover:underline"
                href={companionPublicOrigin}
              >
                Zoen
              </a>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 type-caption text-muted-foreground">
            <Link className="hover:text-foreground" href="/welcome">
              {t("Produto")}
            </Link>
            <Link className="hover:text-foreground" href="/docs">
              {t("Guia")}
            </Link>
            <OnboardingTrigger
              className="font-normal hover:text-foreground"
              size="none"
              variant="quiet"
            >
              {t("Começar")}
            </OnboardingTrigger>
            <Link className="hover:text-foreground" href="/sign-in">
              {t("Entrar")}
            </Link>
          </div>
          <div className="w-full max-w-xs sm:max-w-48">
            <LanguagePicker />
          </div>
        </MarketingFrame>
      </footer>
    </div>
  );
}

function NavItem({
  active,
  item,
}: {
  readonly active?: "product" | "docs";
  readonly item: (typeof nav)[number];
}) {
  const { t } = useI18n();
  const isActive =
    (active === "product" && item.href === "/welcome") ||
    (active === "docs" && item.href === "/docs");
  return (
    <Button
      aria-current={isActive ? "page" : undefined}
      nativeButton={false}
      render={<Link href={item.href} />}
      size="sm"
      variant={isActive ? "secondary" : "quiet"}
    >
      {t(item.label)}
    </Button>
  );
}

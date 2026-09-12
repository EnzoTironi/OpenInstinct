import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@web/components/ui/logo";
import { Button } from "@web/components/ui/button";
import { Separator } from "@web/components/ui/separator";
import { cn } from "@web/components/class-names";
import { companionPublicHost, companionPublicOrigin } from "../public-origin";

const nav = [
  { href: "/welcome", label: "Produto" },
  { href: "/pricing", label: "Preços" },
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
  readonly active?: "product" | "pricing" | "docs";
}) {
  return (
    <div
      className="flex min-h-svh flex-col bg-background text-foreground"
      lang="pt-BR"
    >
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <MarketingFrame className="flex h-16 items-center justify-between gap-4">
          <Link className="flex items-center gap-2 type-label" href="/welcome">
            <Logo />
            <span>Companion</span>
          </Link>
          <nav
            aria-label="Marketing"
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
              Entrar
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/get-started" />}
              size="sm"
            >
              Começar
            </Button>
          </div>
        </MarketingFrame>
        <MarketingFrame className="flex items-center gap-1 pb-3 md:hidden">
          <nav
            aria-label="Marketing no celular"
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
              Entrar
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
              <span>Companion</span>
            </Link>
            <p className="type-caption text-muted-foreground">
              Instinct · Companion para pessoas, profissionais e times.
              Hospedado em{" "}
              <a
                className="underline-offset-4 hover:text-foreground hover:underline"
                href={companionPublicOrigin}
              >
                {companionPublicHost}
              </a>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 type-caption text-muted-foreground">
            <Link className="hover:text-foreground" href="/welcome">
              Produto
            </Link>
            <Link className="hover:text-foreground" href="/pricing">
              Preços
            </Link>
            <Link className="hover:text-foreground" href="/docs">
              Guia
            </Link>
            <Link className="hover:text-foreground" href="/get-started">
              Começar
            </Link>
            <Link className="hover:text-foreground" href="/sign-in">
              Entrar
            </Link>
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
  readonly active?: "product" | "pricing" | "docs";
  readonly item: (typeof nav)[number];
}) {
  const isActive =
    (active === "product" && item.href === "/welcome") ||
    (active === "pricing" && item.href === "/pricing") ||
    (active === "docs" && item.href === "/docs");
  return (
    <Button
      aria-current={isActive ? "page" : undefined}
      nativeButton={false}
      render={<Link href={item.href} />}
      size="sm"
      variant={isActive ? "secondary" : "quiet"}
    >
      {item.label}
    </Button>
  );
}

import { Button } from "@web/components/ui/button";
import { Logo } from "@web/components/ui/logo";
import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  { href: "/welcome", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
] as const;

export function MarketingShell({
  children,
  active,
}: {
  readonly children: ReactNode;
  readonly active?: "product" | "pricing" | "docs";
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link className="flex items-center gap-2 type-label" href="/welcome">
            <Logo />
            <span>Companion</span>
          </Link>
          <nav
            aria-label="Marketing"
            className="hidden items-center gap-1 sm:flex"
          >
            {nav.map((item) => {
              const isActive =
                (active === "product" && item.href === "/welcome") ||
                (active === "pricing" && item.href === "/pricing") ||
                (active === "docs" && item.href === "/docs");

              return (
                <Button
                  key={item.href}
                  nativeButton={false}
                  render={<Link href={item.href} />}
                  size="sm"
                  variant={isActive ? "secondary" : "ghost"}
                >
                  {item.label}
                </Button>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <Button
              className="hidden sm:inline-flex"
              nativeButton={false}
              render={<Link href="/sign-in" />}
              size="sm"
              variant="ghost"
            >
              Sign in
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/get-started" />}
              size="sm"
            >
              Get started
            </Button>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="type-caption text-muted-foreground">
            Instinct · Companion for people, orgs, and prosumers
          </p>
          <div className="flex flex-wrap gap-4 type-caption text-muted-foreground">
            <Link className="hover:text-foreground" href="/welcome">
              Product
            </Link>
            <Link className="hover:text-foreground" href="/pricing">
              Pricing
            </Link>
            <Link className="hover:text-foreground" href="/docs">
              Docs
            </Link>
            <Link className="hover:text-foreground" href="/get-started">
              Get started
            </Link>
            <Link className="hover:text-foreground" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

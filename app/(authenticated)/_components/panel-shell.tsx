"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  HistoryIcon,
  PuzzleIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { PanelLink } from "./panel-link";
import { PanelNavigationContext } from "./panel-navigation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { Button } from "@web/components/ui/button";
import { Logo } from "@web/components/ui/logo";
import { cn } from "@web/components/class-names";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@web/components/ui/drawer";
import { useLocalTime } from "./use-local-time";
import { getLocalDay } from "./local-day";
import { PanelSky } from "./panel-sky";
import styles from "./panel.module.css";

export function PanelShell({
  children,
  background,
}: {
  readonly children: ReactNode;
  readonly background: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const section = useSearchParams().get("section");
  const home = pathname === "/";
  const { sky } = getLocalDay(useLocalTime());
  const [dismissed, setDismissed] = useState(false);
  const open = !home && !dismissed;
  useEffect(() => {
    const reveal = () => {
      setDismissed(false);
    };
    window.addEventListener("popstate", reveal);
    return () => {
      window.removeEventListener("popstate", reveal);
    };
  }, []);
  const conversation =
    pathname.startsWith("/chat") && pathname !== "/chat/history";
  const accountDetail = pathname === "/account" && !!section;
  return (
    <PanelNavigationContext
      value={() => {
        setDismissed(false);
      }}
    >
      <div className={styles.shell} lang="pt-BR">
        <PanelSky phase={sky} />
        <a className={styles.skipLink} href="#panel-content">
          Pular para o conteúdo
        </a>
        <div
          className={cn(styles.frame, styles.homeFrame)}
          inert={!home}
          aria-hidden={!home || undefined}
        >
          <header className={styles.header}>
            <Link aria-label="Zoen · Início" className={styles.brand} href="/">
              <Logo />
              <span>Zoen</span>
            </Link>
            <PanelDate />
            <Button
              aria-label="Sua conta"
              className={styles.accountButton}
              nativeButton={false}
              render={<PanelLink href="/account" />}
              size="icon"
              variant="ghost"
            >
              <UserRoundIcon aria-hidden="true" />
            </Button>
          </header>
          <div
            className={cn(styles.surface, styles.homeSurface)}
            id={home ? "panel-content" : undefined}
            tabIndex={home ? -1 : undefined}
          >
            <div className={styles.content}>
              {background}
              {home && children}
            </div>
          </div>
        </div>
        <p className={styles.signature} aria-hidden={!home || undefined}>
          Menos na cabeça. Mais na vida.
        </p>
        <Drawer
          open={open}
          onOpenChangeComplete={(isOpen) => {
            if (!isOpen && dismissed && !home)
              router.push("/", { scroll: false });
          }}
          showSwipeHandle
          onOpenChange={(isOpen) => {
            if (!isOpen) setDismissed(true);
          }}
        >
          <DrawerContent
            className={cn(
              styles.innerFrame,
              styles.drawerPanel,
              (pathname === "/recipes" || conversation) && styles.wideFrame,
              conversation && styles.drawerConversation
            )}
            lang="pt-BR"
          >
            <PanelSky phase={sky} />
            <DrawerTitle className="sr-only">Seu espaço Zoen</DrawerTitle>
            <div className={styles.sheetChrome}>
              {accountDetail && (
                <Button
                  aria-label="Voltar à conta"
                  className={styles.sheetBack}
                  nativeButton={false}
                  render={<PanelLink href="/account" />}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowLeftIcon aria-hidden="true" />
                </Button>
              )}
              {conversation && (
                <Button
                  aria-label="Conectar ferramentas"
                  className={styles.sheetConnections}
                  nativeButton={false}
                  render={
                    <Link
                      href={`/connections?returnTo=${encodeURIComponent(googleWorkspaceReturnTo(pathname))}`}
                    />
                  }
                  size="icon"
                  variant="ghost"
                >
                  <PuzzleIcon aria-hidden="true" />
                </Button>
              )}
              {conversation && (
                <Button
                  aria-label="Histórico de conversas"
                  className={styles.sheetBack}
                  nativeButton={false}
                  render={<Link href="/chat/history" />}
                  size="icon"
                  variant="ghost"
                >
                  <HistoryIcon aria-hidden="true" />
                </Button>
              )}
              <DrawerClose
                render={
                  <Button
                    aria-label="Fechar painel"
                    className={styles.sheetClose}
                    size="icon"
                    variant="ghost"
                  />
                }
              >
                <XIcon aria-hidden="true" />
              </DrawerClose>
            </div>
            <div
              className={styles.content}
              id={!home ? "panel-content" : undefined}
              key={`${pathname}:${section ?? ""}`}
              tabIndex={-1}
            >
              {!home && children}
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </PanelNavigationContext>
  );
}

function PanelDate() {
  const date = useLocalTime();
  return (
    <time className={styles.date} dateTime={date?.toISOString()}>
      {date
        ? new Intl.DateTimeFormat("pt-BR", {
            weekday: "short",
            day: "numeric",
            month: "short",
          })
            .format(date)
            .replaceAll(".", "")
        : "Seu espaço pessoal"}
    </time>
  );
}

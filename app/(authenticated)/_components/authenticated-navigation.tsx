"use client";

import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@web/components/ui/sidebar";
import {
  ClockIcon,
  HistoryIcon,
  KeyRoundIcon,
  GlobeIcon,
  MessageSquareIcon,
  HouseIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", icon: HouseIcon, id: "workspace", label: "Home" },
  { href: "/chat", icon: MessageSquareIcon, id: "chat", label: "Conversation" },
  {
    href: "/chat/history",
    icon: HistoryIcon,
    id: "history",
    label: "Conversation history",
  },
  {
    href: "/reminders",
    icon: ClockIcon,
    id: "reminders",
    label: "Reminders",
  },
  {
    href: "/personal-info",
    icon: UserRoundIcon,
    id: "personal-info",
    label: "Personal info",
  },
  { href: "/tasks", icon: GlobeIcon, id: "tasks", label: "Browser activity" },
  { href: "/vault", icon: KeyRoundIcon, id: "vault", label: "Vault" },
] as const;

export function AuthenticatedNavigation() {
  const pathname = usePathname();
  const active = activeRoute(pathname);
  const returnTo = googleWorkspaceReturnTo(pathname);

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <nav aria-label="Primary">
          <SidebarMenu>
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <SidebarMenuItem
                  className={
                    item.id === "tasks"
                      ? "mt-4 border-t border-border/50 pt-4"
                      : undefined
                  }
                  key={item.id}
                >
                  <SidebarMenuButton
                    isActive={active === item.id}
                    render={
                      <Link
                        href={
                          item.id === "workspace" && returnTo !== "/"
                            ? `/?returnTo=${encodeURIComponent(returnTo)}`
                            : item.href
                        }
                      />
                    }
                  >
                    <Icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AuthenticatedMobileHeader() {
  const active = activeRoute(usePathname());
  const label = navigation.find((item) => item.id === active)?.label;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-4 md:hidden">
      <SidebarTrigger />
      <span className="type-label">{label}</span>
    </header>
  );
}

function prefixActiveRoute(pathname: string) {
  if (pathname.startsWith("/vault")) {
    return "vault";
  }

  if (pathname.startsWith("/personal-info")) {
    return "personal-info";
  }

  if (pathname.startsWith("/reminders")) {
    return "reminders";
  }

  if (pathname.startsWith("/chat/history")) {
    return "history";
  }

  if (pathname.startsWith("/chat")) {
    return "chat";
  }

  if (pathname.startsWith("/tasks")) {
    return "tasks";
  }

  return undefined;
}

function activeRoute(pathname: string) {
  if (pathname === "/") {
    return "workspace";
  }

  return prefixActiveRoute(pathname);
}

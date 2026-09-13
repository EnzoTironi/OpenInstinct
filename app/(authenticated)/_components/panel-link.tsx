"use client";

import { useContext, type ComponentProps } from "react";
import Link from "next/link";
import { PanelNavigationContext } from "./panel-navigation";
import { useSearchParams } from "next/navigation";
import { workspaceHref } from "@web/workspaces/navigation";

export function PanelLink({
  onNavigate,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { readonly href: string }) {
  const reveal = useContext(PanelNavigationContext);
  const workspaceId = useSearchParams().get("space");
  return (
    <Link
      prefetch
      {...props}
      href={workspaceHref(props.href, workspaceId)}
      scroll={false}
      onNavigate={(event) => {
        onNavigate?.(event);
        reveal?.();
      }}
    />
  );
}

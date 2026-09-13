"use client";

import { useContext, type ComponentProps } from "react";
import Link from "next/link";
import { PanelNavigationContext } from "./panel-navigation";

export function PanelLink({
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const reveal = useContext(PanelNavigationContext);
  return (
    <Link
      prefetch
      {...props}
      scroll={false}
      onNavigate={(event) => {
        onNavigate?.(event);
        reveal?.();
      }}
    />
  );
}

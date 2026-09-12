import type { ComponentPropsWithoutRef } from "react";
import Image from "next/image";

type LogoProps = Omit<
  ComponentPropsWithoutRef<typeof Image>,
  "src" | "alt" | "width" | "height"
>;

function Logo({ className, ...props }: LogoProps) {
  return (
    <Image
      alt=""
      className={["size-8 shrink-0 rounded-full", className]
        .filter(Boolean)
        .join(" ")}
      data-slot="logo"
      height={32}
      src="/marketing/zoen-avatar.webp"
      unoptimized
      width={32}
      {...props}
    />
  );
}

export { Logo };
export type { LogoProps };

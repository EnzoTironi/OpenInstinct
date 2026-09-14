import Image from "next/image";
import { cn } from "@web/components/class-names";
import { type getLocalDay, skyPhases } from "./local-day";
import styles from "./sky.module.css";

export function Sky({
  phase,
  embedded = false,
}: {
  readonly phase: ReturnType<typeof getLocalDay>["sky"];
  readonly embedded?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(styles.skyBackdrop, embedded && styles.embedded)}
      data-sky={phase}
    >
      {skyPhases.map((sky) => (
        <Image
          alt=""
          className={cn(styles.skyLayer, sky === phase && styles.skyVisible)}
          fetchPriority="low"
          fill
          key={sky}
          loading="eager"
          sizes="100vw"
          src={`/marketing/sky-${sky}.webp`}
          unoptimized
        />
      ))}
    </div>
  );
}

import Image from "next/image";
import { cn } from "@web/components/class-names";
import { type getLocalDay, skyPhases } from "./local-day";
import styles from "./panel.module.css";

export function PanelSky({
  phase,
}: {
  readonly phase: ReturnType<typeof getLocalDay>["sky"];
}) {
  return (
    <div aria-hidden="true" className={styles.skyBackdrop} data-sky={phase}>
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

"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import styles from "./marketing-landing.module.css";

const phases = [
  "midnight",
  "predawn",
  "dawn",
  "day",
  "sunset",
  "dusk",
  "nightfall",
] as const;

export function SkyBackdrop() {
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = backdrop.current;
    const landing = element?.parentElement;
    if (!element || !landing) return undefined;

    const sections = Array.from(
      landing.querySelectorAll<HTMLElement>(":scope > section[data-sky]")
    );
    const layers = Array.from(element.querySelectorAll("img"));
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const update = () => {
      frame = 0;
      if (motion.matches) {
        delete landing.dataset.skyReady;
        return;
      }

      const position =
        -landing.getBoundingClientRect().top + window.innerHeight * 0.4;
      const next = sections.find((section) => section.offsetTop > position);
      const previous =
        sections.findLast((section) => section.offsetTop <= position) ??
        sections[0];
      if (!previous) return;

      const start = Number(previous.dataset.sky);
      const fraction = next
        ? Math.max(
            0,
            (position - previous.offsetTop) /
              (next.offsetTop - previous.offsetTop)
          )
        : 0;
      const phase =
        start + (Number(next?.dataset.sky ?? start) - start) * fraction;
      layers.forEach((layer, index) => {
        layer.style.opacity = String(
          Math.max(0, Math.min(1, phase - index + 1))
        );
      });
      landing.dataset.skyReady = "true";
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(landing);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    motion.addEventListener("change", schedule);
    schedule();

    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      motion.removeEventListener("change", schedule);
      delete landing.dataset.skyReady;
    };
  }, []);

  return (
    <div aria-hidden="true" className={styles.skyBackdrop} ref={backdrop}>
      {phases.map((phase, index) => (
        <Image
          alt=""
          className={styles.skyLayer}
          fetchPriority={index === 0 ? "high" : "low"}
          fill
          key={phase}
          loading="eager"
          sizes="100vw"
          src={`/marketing/sky-${phase === "nightfall" ? "midnight" : phase}.webp`}
          unoptimized
        />
      ))}
    </div>
  );
}

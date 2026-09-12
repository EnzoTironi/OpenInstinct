"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import styles from "./marketing-landing.module.css";

const phrases = [
  ["lembrar de", "tudo sozinho."],
  ["cuidar de", "cada detalhe."],
  ["resolver tudo", "sem ajuda."],
  ["dar conta de", "tudo sozinho."],
  ["guardar cada", "ideia na cabeça."],
  ["organizar cada", "parte do seu dia."],
  ["lembrar de", "todos os prazos."],
  ["juntar sozinho", "todas as pontas."],
] as const;

export function RotatingHeadline() {
  const [current, setCurrent] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = window.setInterval(() => {
      setCurrent((index) => (index + 1) % phrases.length);
    }, 4200);
    return () => {
      window.clearInterval(timer);
    };
  }, [reduceMotion]);

  return (
    <span className={styles.rotatingHeadline}>
      <span className="sr-only">cuidar de tudo sozinho.</span>
      {phrases.map(([firstLine, secondLine], index) => (
        <em
          aria-hidden="true"
          className={styles.rotatingPhrase}
          data-active={index === current}
          key={firstLine + secondLine}
        >
          {firstLine}
          <br />
          {secondLine}
        </em>
      ))}
    </span>
  );
}

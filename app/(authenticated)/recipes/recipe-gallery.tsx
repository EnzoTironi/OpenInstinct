"use client";

import { useI18n } from "@web/i18n/context";

import { useState } from "react";
import { ArrowUpRightIcon, SearchIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Input } from "@web/components/ui/input";
import { chatStarters } from "../_lib/chat-starters";
import styles from "./recipes.module.css";

const categories = [
  "Destaques",
  "Todas",
  "Dia a dia",
  "Trabalho",
  "Memória",
] as const;
const featured = new Set(["reminder", "briefing", "memory"]);
const illustrations: Record<(typeof chatStarters)[number]["id"], string> = {
  reminder: "zoen-reminder.png",
  briefing: "zoen-briefing.png",
  decision: "zoen-decision.png",
  meeting: "zoen-meeting.png",
  preference: "zoen-memory.png",
  memory: "zoen-memory.png",
  email: "zoen-email.png",
  "email-draft": "zoen-email.png",
  integration: "zoen-integration.png",
};

export function RecipeGallery() {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState<string>("Destaques");
  const [query, setQuery] = useState("");
  const matching = chatStarters.filter((recipe) => {
    const inCategory =
      category === "Todas" ||
      (category === "Destaques"
        ? !!query.trim() || featured.has(recipe.id)
        : recipe.category === category);
    return (
      inCategory &&
      `${t(recipe.label)} ${t(recipe.description)} ${t(recipe.category)}`
        .toLocaleLowerCase(locale)
        .includes(query.trim().toLocaleLowerCase(locale))
    );
  });
  return (
    <>
      <div className={styles.filters}>
        <select
          aria-label={t("Categoria de receitas")}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        >
          {categories.map((label) => (
            <option key={label} value={label}>
              {t(label)}
            </option>
          ))}
        </select>
        <div className={styles.search}>
          <SearchIcon aria-hidden="true" />
          <Input
            aria-label={t("Buscar receitas")}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder={t("Uma ideia…")}
            value={query}
          />
        </div>
      </div>
      <div className={styles.grid}>
        {matching.map((recipe) => (
          <Link
            className={styles.recipe}
            key={recipe.id}
            href={`/chat?starter=${recipe.id}`}
          >
            <div className={styles.art}>
              <Image
                src={`/marketing/panel/${illustrations[recipe.id]}`}
                alt=""
                fill
                sizes="(max-width: 600px) 90vw, (max-width: 850px) 45vw, 290px"
              />
            </div>
            <div className={styles.recipeCopy}>
              <span className={styles.category}>{t(recipe.category)}</span>
              <h2 className="type-section-title">{t(recipe.label)}</h2>
              <ArrowUpRightIcon aria-hidden="true" />
            </div>
          </Link>
        ))}
      </div>
      {matching.length === 0 && (
        <output className={styles.noResults}>
          {t("Nenhuma ideia por aqui. Tente outra busca.")}
        </output>
      )}
      <p className={styles.footer}>
        <Link href="/chat">{t("Ou me conte a sua ideia.")}</Link>
      </p>
    </>
  );
}

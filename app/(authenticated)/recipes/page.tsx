"use client";

import { useI18n } from "@web/i18n/context";
import { RecipeGallery } from "./recipe-gallery";
import styles from "../_components/panel.module.css";

export default function RecipesPage() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <header>
        <h1 className="type-page-title">{t("Uma ideia já ajuda.")}</h1>
        <p className={styles.intro}>
          {t("Escolha um começo. Faça do seu jeito.")}
        </p>
      </header>
      <RecipeGallery />
    </div>
  );
}

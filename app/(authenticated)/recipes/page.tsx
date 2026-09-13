import { RecipeGallery } from "./recipe-gallery";
import styles from "../_components/panel.module.css";

export default function RecipesPage() {
  return (
    <div className={styles.page}>
      <header>
        <h1 className="type-page-title">Uma ideia já ajuda.</h1>
        <p className={styles.intro}>Escolha um começo. Faça do seu jeito.</p>
      </header>
      <RecipeGallery />
    </div>
  );
}

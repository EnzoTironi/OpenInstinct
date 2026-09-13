import Image from "next/image";
import styles from "./panel.module.css";

export function PanelIntro({
  image,
  title,
  description,
}: {
  readonly image: string;
  readonly title: string;
  readonly description?: string;
}) {
  return (
    <header className={styles.visualIntro}>
      <div className={styles.illustration}>
        <Image src={image} alt="" fill sizes="(max-width: 760px) 90vw, 540px" />
      </div>
      <h1 className="type-page-title">{title}</h1>
      {description && <p className={styles.intro}>{description}</p>}
    </header>
  );
}

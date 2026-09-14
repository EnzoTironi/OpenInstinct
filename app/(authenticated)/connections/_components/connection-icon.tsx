import Image from "next/image";
import { GoogleIcon } from "@web/components/ui/google-icon";
import styles from "../../_components/connections.module.css";

export function ConnectionIcon({
  provider,
}: {
  readonly provider: "google" | "telegram" | "kapso";
}) {
  return (
    <span className={styles.icon} aria-hidden="true">
      {provider === "google" ? (
        <GoogleIcon />
      ) : (
        <Image
          src={`/marketing/${provider === "kapso" ? "whatsapp" : "telegram"}.avif`}
          alt=""
          width={34}
          height={34}
        />
      )}
    </span>
  );
}

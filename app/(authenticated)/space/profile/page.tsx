"use client";

import { useState } from "react";
import { AtSignIcon, CheckIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function DirectoryProfilePage() {
  const { t } = useI18n();
  const profile = api.workspaces.profile.read.useQuery();
  const save = api.workspaces.profile.save.useMutation();
  const [username, setUsername] = useState<string>();
  const [discoverable, setDiscoverable] = useState<boolean>();
  const selectedName = username ?? profile.data?.username ?? "";
  const visible = discoverable ?? profile.data?.discoverable ?? false;
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-friendly.jpg"
        title={t("Um nome para encontrar você.")}
      />
      <form
        className={styles.create}
        onSubmit={(event) => {
          event.preventDefault();
          void save
            .mutateAsync({ username: selectedName, discoverable: visible })
            .then(() => profile.refetch())
            .catch(() => undefined);
        }}
      >
        <label className={styles.row} htmlFor="directory-username">
          <AtSignIcon aria-hidden="true" />
          <Input
            id="directory-username"
            aria-label={t("Seu username")}
            placeholder="username"
            autoComplete="username"
            value={selectedName}
            required
            pattern="[a-z][a-z0-9_]{2,29}"
            minLength={3}
            maxLength={30}
            onChange={(event) => {
              setUsername(event.target.value.toLowerCase().replace(/^@/, ""));
              save.reset();
            }}
          />
        </label>
        <p className={styles.caption}>
          {t("De 3 a 30 letras, números ou _. Comece com uma letra.")}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={visible}
          className={styles.row}
          onClick={() => {
            setDiscoverable(!visible);
            save.reset();
          }}
        >
          <span>
            {t("Aparecer na busca")}
            <small>
              {t(
                "Seu @ fica visível. Seus arquivos e memórias continuam privados."
              )}
            </small>
          </span>
          <span
            className={styles.toggle}
            data-active={visible}
            aria-hidden="true"
          >
            <span />
          </span>
        </button>
        <p className={styles.caption}>
          {t(
            "Quem souber seu @ pode convidar você para uma equipe. Você escolhe se aceita."
          )}
        </p>
        {(profile.error ?? save.error) && (
          <p role="alert" className={styles.error}>
            {t(
              "Este nome pode estar indisponível. Tente outro ou tente novamente."
            )}
          </p>
        )}
        <Button type="submit" disabled={profile.isPending || save.isPending}>
          {save.isSuccess && <CheckIcon />}
          {t(save.isSuccess ? "Salvo" : "Salvar")}
        </Button>
      </form>
    </div>
  );
}

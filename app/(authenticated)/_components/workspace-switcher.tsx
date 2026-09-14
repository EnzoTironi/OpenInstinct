"use client";

import { BriefcaseBusinessIcon, ChevronDownIcon, HomeIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import styles from "./workspace-switcher.module.css";
import { workspaceHref } from "@web/workspaces/navigation";

export function WorkspaceSwitcher() {
  const { t } = useI18n();
  const router = useRouter();
  const selected = useSearchParams().get("space");
  const { data, isPending } = api.workspaces.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const active =
    data?.find((workspace) => workspace.id === selected) ??
    data?.find((workspace) => !workspace.organizationId);
  const work = active ? !!active.organizationId : !!selected;
  return (
    <label className={styles.switcher}>
      {work ? (
        <BriefcaseBusinessIcon aria-hidden="true" />
      ) : (
        <HomeIcon aria-hidden="true" />
      )}
      <span className={styles.label}>
        {work ? (active?.name ?? t("Seu espaço")) : t("Pessoal")}
      </span>
      <ChevronDownIcon aria-hidden="true" />
      <select
        aria-label={t("Trocar espaço")}
        disabled={isPending}
        value={selected ?? "personal"}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === "manage")
            router.push(workspaceHref("/space", selected), { scroll: false });
          else if (value === "create")
            router.push("/space?create=1", { scroll: false });
          else
            router.push(
              value === "personal"
                ? "/"
                : `/?space=${encodeURIComponent(value)}`,
              { scroll: false }
            );
        }}
      >
        {isPending && selected && (
          <option value={selected}>{t("Seu espaço")}</option>
        )}
        <option value="personal">{t("Pessoal")}</option>
        {data
          ?.filter((workspace) => workspace.organizationId)
          .map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        <optgroup label={t("Seu espaço")}>
          <option value="manage">{t("Arquivos, agente e memórias")}</option>
          <option value="create">{t("Criar espaço de trabalho")}</option>
        </optgroup>
      </select>
    </label>
  );
}

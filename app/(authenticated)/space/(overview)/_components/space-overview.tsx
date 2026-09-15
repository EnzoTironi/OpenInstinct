"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BrainIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  FolderOpenIcon,
  PlusIcon,
  SparklesIcon,
  UploadIcon,
  PuzzleIcon,
  UsersIcon,
  AtSignIcon,
  WrenchIcon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { agentFiles } from "@shared/workspaces/agent-files";
import { workspaceHref } from "@web/workspaces/navigation";
import { PanelIntro } from "../../../_components/panel-intro";
import { PanelLink } from "../../../_components/panel-link";
import { ToolLibrary } from "./tool-library";
import { FileEditor } from "./file-editor";
import { PluginSettings } from "./plugin-settings";
import panel from "../../../_components/panel.module.css";
import styles from "../../space.module.css";

export function SpaceOverview() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const [category, setCategory] = useState<
    "knowledge" | "agent" | "skills" | "plugins" | "tools"
  >(search.get("tab") === "plugins" ? "plugins" : "knowledge");
  const [path, setPath] = useState<string>();
  const [newFile, setNewFile] = useState(false);
  const [name, setName] = useState("");
  const create = api.workspaces.create.useMutation();
  const listing = api.workspaces.files.useQuery({});
  const file = api.workspaces.files.useQuery(
    { path },
    { enabled: !!path && !!listing.data?.files.includes(path) }
  );
  const spaces = api.workspaces.list.useQuery();
  const active =
    spaces.data?.find((space) => space.id === search.get("space")) ??
    spaces.data?.find((space) => !space.organizationId);
  const mayManage = active?.role === "owner" || active?.role === "admin";
  const template = agentFiles.find((item) => item.path === path);
  if (search.get("create") === "1")
    return (
      <div className={panel.page}>
        <PanelIntro
          image="/marketing/panel/zoen-together.jpg"
          title={t("Um espaço para sua equipe.")}
        />
        <form
          className={styles.create}
          onSubmit={(event) => {
            event.preventDefault();
            void create
              .mutateAsync({ name: name.trim() })
              .then(({ workspaceId }) => {
                router.replace(
                  `/space?space=${encodeURIComponent(workspaceId)}`
                );
                return undefined;
              })
              .catch(() => undefined);
          }}
        >
          <Input
            size="xl"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder={t("Nome da equipe")}
            aria-label={t("Nome da equipe")}
            maxLength={80}
            required
          />
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? t("Criando…") : t("Criar espaço")}
          </Button>
          {create.error && (
            <p role="alert">
              {t("Não foi possível criar o espaço. Tente novamente.")}
            </p>
          )}
        </form>
      </div>
    );
  if (path) {
    const exists = listing.data?.files.includes(path);
    if (exists && file.isPending)
      return <output className={panel.page}>{t("Carregando…")}</output>;
    if (exists && file.error)
      return (
        <div className={panel.page}>
          <p role="alert">{t("Não foi possível abrir o arquivo.")}</p>
          <Button
            onClick={() => {
              setPath(undefined);
            }}
          >
            {t("Voltar")}
          </Button>
        </div>
      );
    return (
      <FileEditor
        key={path}
        path={path}
        content={
          exists
            ? (file.data?.content ?? "")
            : template
              ? t(template.content)
              : `# ${name || t("Nova skill")}\n\n`
        }
        revision={listing.data?.revision ?? null}
        readOnly={category !== "knowledge" && !mayManage}
        onClose={() => {
          setPath(undefined);
        }}
        onSaved={async () => {
          await file.refetch();
          await listing.refetch();
        }}
      />
    );
  }
  const files =
    listing.data?.files.filter((filename) =>
      filename.startsWith(`${category}/`)
    ) ?? [];
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-memory.png"
        title={t("Tudo que faz o seu Zoen.")}
      />
      <div className={styles.tabs} role="tablist" aria-label={t("Seu espaço")}>
        {(
          [
            ["knowledge", "Arquivos", FolderOpenIcon],
            ["agent", "Seu agente", SparklesIcon],
            ["skills", "Skills", FileTextIcon],
            ["tools", "Ferramentas", WrenchIcon],
            ["plugins", "Plugins", PuzzleIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            role="tab"
            aria-selected={category === id}
            type="button"
            key={id}
            onClick={() => {
              setCategory(id);
            }}
          >
            <Icon aria-hidden="true" />
            {t(label)}
          </button>
        ))}
      </div>
      {category === "tools" && <ToolLibrary mayManage={mayManage} />}
      {category === "plugins" && <PluginSettings mayManage={mayManage} />}
      {listing.error && (
        <p className={styles.error} role="alert">
          {t("Não foi possível abrir seu espaço.")}
        </p>
      )}
      {category !== "plugins" && category !== "tools" && (
        <div className={styles.list}>
          {category === "agent"
            ? agentFiles.map((item) => (
                <button
                  className={styles.row}
                  key={item.path}
                  type="button"
                  disabled={
                    !mayManage && !listing.data?.files.includes(item.path)
                  }
                  onClick={() => {
                    setPath(item.path);
                  }}
                >
                  <SparklesIcon aria-hidden="true" />
                  <span>
                    {t(item.label)}
                    <small>{item.path.split("/").at(-1)}</small>
                  </span>
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              ))
            : files.map((filename) => (
                <button
                  className={styles.row}
                  type="button"
                  key={filename}
                  onClick={() => {
                    setPath(filename);
                  }}
                >
                  <FileTextIcon aria-hidden="true" />
                  <span>
                    {filename
                      .split("/")
                      .at(-1)
                      ?.replace(/\.md$/, "")
                      .replaceAll("-", " ")}
                  </span>
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              ))}
        </div>
      )}
      {category !== "agent" &&
        category !== "plugins" &&
        category !== "tools" &&
        files.length === 0 &&
        !listing.isPending && (
          <p className={styles.empty}>
            {t(
              category === "skills"
                ? "Ensine um jeito de fazer."
                : "Suas ideias, documentos e decisões. Tudo aqui."
            )}
          </p>
        )}
      {listing.isPending && <output>{t("Carregando…")}</output>}
      {category !== "agent" &&
        category !== "plugins" &&
        category !== "tools" &&
        (category !== "skills" || mayManage) && (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                setName("");
                setNewFile(true);
              }}
            >
              <PlusIcon />
              {t(category === "skills" ? "Nova skill" : "Novo arquivo")}
            </Button>
            {category === "knowledge" && (
              <Button
                variant="ghost"
                nativeButton={false}
                render={<PanelLink href="/space/import" />}
              >
                <UploadIcon />
                {t("Importar")}
              </Button>
            )}
          </div>
        )}
      {newFile && (
        <form
          className={styles.create}
          onSubmit={(event) => {
            event.preventDefault();
            const slug = name
              .normalize("NFKD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 80);
            if (slug) {
              setPath(`${category}/${slug}.md`);
              setNewFile(false);
            }
          }}
        >
          <Input
            aria-label={t("Nome do arquivo")}
            placeholder={t("Nome do arquivo")}
            value={name}
            maxLength={80}
            required
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Button type="submit">{t("Continuar")}</Button>
        </form>
      )}
      <div className={styles.bottomLinks}>
        <PanelLink href="/space/knowledge">
          <FolderOpenIcon />
          {t("Conhecimento conectado")}
        </PanelLink>
        <PanelLink href="/space/bot">
          <SparklesIcon />
          {t("Seu bot")}
        </PanelLink>
        <PanelLink href="/space/team">
          <UsersIcon />
          {t(active?.organizationId ? "Sua equipe" : "Convites")}
        </PanelLink>
        <PanelLink href="/space/profile">
          <AtSignIcon />
          {t("Seu username")}
        </PanelLink>
        <PanelLink href="/space/memory">
          <BrainIcon />
          {t("Memórias aprendidas")}
        </PanelLink>
        {listing.data?.revision && (
          <a
            href={workspaceHref("/api/workspaces/export", search.get("space"))}
          >
            <DownloadIcon />
            {t("Exportar")}
          </a>
        )}
      </div>
    </div>
  );
}

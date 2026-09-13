"use client";

import { BrainIcon, FolderOpenIcon, MailIcon, NetworkIcon } from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import {
  capabilitiesPath,
  workspacePlugins,
} from "@shared/workspaces/capabilities";
import styles from "../../space.module.css";

export function PluginSettings({ mayManage }: { readonly mayManage: boolean }) {
  const { t } = useI18n();
  const settings = api.workspaces.capabilities.useQuery();
  const write = api.workspaces.write.useMutation();
  const cache = api.useUtils();
  return (
    <>
      <div className={styles.list}>
        {workspacePlugins.map((plugin) => {
          const enabled = settings.data?.enabled.includes(plugin.id) ?? false;
          const Icon = {
            files: FolderOpenIcon,
            memory: BrainIcon,
            google: MailIcon,
            ontology: NetworkIcon,
          }[plugin.id];
          return (
            <button
              key={plugin.id}
              type="button"
              role="switch"
              aria-checked={enabled}
              className={styles.row}
              disabled={!mayManage || !settings.data || write.isPending}
              onClick={() => {
                if (!settings.data) return;
                const next = enabled
                  ? settings.data.enabled.filter((id) => id !== plugin.id)
                  : [...settings.data.enabled, plugin.id];
                void write
                  .mutateAsync({
                    path: capabilitiesPath,
                    expectedRevision: settings.data.revision,
                    operationId: crypto.randomUUID(),
                    content: JSON.stringify(
                      { version: 1, enabled: next },
                      null,
                      2
                    ),
                  })
                  .then(() => cache.workspaces.invalidate())
                  .catch(() => undefined);
              }}
            >
              <Icon aria-hidden="true" />
              <span>
                {t(plugin.label)}
                <small>{t(plugin.description)}</small>
              </span>
              <span
                className={styles.toggle}
                data-active={enabled}
                aria-hidden="true"
              >
                <span />
              </span>
            </button>
          );
        })}
      </div>
      {(settings.error ?? write.error) && (
        <p role="alert" className={styles.error}>
          {t("Não foi possível atualizar os plugins. Tente novamente.")}
        </p>
      )}
      <p className={styles.empty}>
        {t(
          mayManage
            ? "Você escolhe o que o Zoen pode usar neste espaço."
            : "Sua equipe gerencia os plugins deste espaço."
        )}
      </p>
    </>
  );
}

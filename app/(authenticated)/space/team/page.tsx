"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AtSignIcon,
  CheckIcon,
  UserPlusIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { PanelIntro } from "../../_components/panel-intro";
import { PanelLink } from "../../_components/panel-link";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function WorkspaceTeamPage() {
  const { t } = useI18n();
  const router = useRouter();
  const work = !!useSearchParams().get("space");
  const cache = api.useUtils();
  const team = api.workspaces.team.list.useQuery();
  const invitations = api.workspaces.team.invitations.useQuery();
  const invite = api.workspaces.team.invite.useMutation();
  const answer = api.workspaces.team.answer.useMutation();
  const remove = api.workspaces.team.remove.useMutation();
  const revoke = api.workspaces.team.revoke.useMutation();
  const [username, setUsername] = useState("");
  const search = api.workspaces.profile.search.useQuery(
    { query: username },
    { enabled: username.length >= 2 }
  );
  const refresh = () => cache.workspaces.invalidate();
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-together.jpg"
        title={t(work ? "Juntos, no mesmo espaço." : "Seu próximo espaço.")}
      />
      {(team.error ??
        invitations.error ??
        invite.error ??
        answer.error ??
        remove.error ??
        revoke.error) && (
        <p role="alert" className={styles.error}>
          {t("Não foi possível concluir. Confira o @ e tente novamente.")}
        </p>
      )}
      {!!invitations.data?.length && (
        <div className={styles.list}>
          {invitations.data.map((item) => (
            <div className={styles.row} key={item.id}>
              <UserPlusIcon aria-hidden="true" />
              <span>
                {item.name}
                <small>
                  {item.username
                    ? `@${item.username}`
                    : t("Convite para equipe")}
                </small>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Recusar convite")}
                disabled={answer.isPending}
                onClick={() => {
                  void answer
                    .mutateAsync({ id: item.id, accept: false })
                    .then(refresh)
                    .catch(() => undefined);
                }}
              >
                <XIcon />
              </Button>
              <Button
                size="icon"
                aria-label={t("Aceitar convite")}
                disabled={answer.isPending}
                onClick={() => {
                  void answer
                    .mutateAsync({ id: item.id, accept: true })
                    .then(async ({ workspaceId }) => {
                      await refresh();
                      router.push(
                        `/space?space=${encodeURIComponent(workspaceId)}`
                      );
                      return undefined;
                    })
                    .catch(() => undefined);
                }}
              >
                <CheckIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
      {team.data?.mayManage && (
        <form
          className={styles.create}
          onSubmit={(event) => {
            event.preventDefault();
            void invite
              .mutateAsync({ username })
              .then(async () => {
                setUsername("");
                await refresh();
                return undefined;
              })
              .catch(() => undefined);
          }}
        >
          <div className={styles.row}>
            <AtSignIcon aria-hidden="true" />
            <Input
              aria-label={t("Convidar pelo username")}
              placeholder={t("Convidar pelo username")}
              value={username}
              maxLength={30}
              pattern="[a-z][a-z0-9_]{2,29}"
              required
              onChange={(event) => {
                setUsername(event.target.value.toLowerCase().replace(/^@/, ""));
                invite.reset();
              }}
            />
            <Button
              size="icon"
              type="submit"
              aria-label={t("Convidar")}
              disabled={invite.isPending || username.length < 3}
            >
              <UserPlusIcon />
            </Button>
          </div>
          {username.length >= 2 && !!search.data?.length && (
            <div className={styles.list}>
              {search.data.map((person) => (
                <button
                  className={styles.row}
                  key={person.username}
                  type="button"
                  onClick={() => {
                    setUsername(person.username);
                  }}
                >
                  <AtSignIcon aria-hidden="true" />
                  <span>{person.username}</span>
                </button>
              ))}
            </div>
          )}
          {invite.isSuccess && (
            <output>{t("Convite disponível no app dessa pessoa.")}</output>
          )}
        </form>
      )}
      {!!team.data?.members.length && (
        <div className={styles.list}>
          {team.data.members.map((member) => (
            <div className={styles.row} key={member.userId}>
              <UserRoundIcon aria-hidden="true" />
              <span>
                {member.username ? `@${member.username}` : member.name}
                <small>
                  {t(member.role === "member" ? "Membro" : "Administrador")}
                </small>
              </span>
              {team.data.mayManage && member.role === "member" && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("Remover acesso")}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        t(
                          "Remover esta pessoa do espaço? Ela perderá acesso aos arquivos e à sua memória de trabalho."
                        )
                      )
                    )
                      void remove
                        .mutateAsync({ userId: member.userId })
                        .then(refresh)
                        .catch(() => undefined);
                  }}
                >
                  <XIcon />
                </Button>
              )}
            </div>
          ))}
          {team.data.invites.map((item) => (
            <div className={styles.row} key={item.id}>
              <UserPlusIcon aria-hidden="true" />
              <span>
                @{item.username}
                <small>{t("Convite pendente")}</small>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Cancelar convite")}
                disabled={revoke.isPending}
                onClick={() => {
                  void revoke
                    .mutateAsync({ id: item.id })
                    .then(refresh)
                    .catch(() => undefined);
                }}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
      {!work && !invitations.data?.length && (
        <p className={styles.empty}>
          {t("Seus convites para equipes aparecem aqui.")}
        </p>
      )}
      <div className={styles.bottomLinks}>
        <PanelLink href="/space/profile">
          <AtSignIcon />
          {t("Escolher meu username")}
        </PanelLink>
      </div>
    </div>
  );
}

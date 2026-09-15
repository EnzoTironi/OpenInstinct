import { getI18n } from "@web/i18n/server";
import { VaultAddresses } from "./_components/addresses";
import { VaultCards } from "./_components/cards";
import { VaultContacts } from "./_components/contacts";
import { VaultLogins } from "./_components/logins";
import { VaultOtherItems } from "./_components/other";
import { readVaultItems } from "@db/services/vault";
import { requireRequestScope } from "@web/auth/request-scope";
import { Effect, Option } from "effect";
import { serverRuntime } from "../../../server/runtime";
import { requireVaultwarden } from "../../../server/workspaces/vault";
import { Button } from "@web/components/ui/button";
import { LockKeyholeIcon, ArrowUpRightIcon } from "lucide-react";

export default async function Page() {
  const { t } = await getI18n();
  const scope = await requireRequestScope();
  const hosted = await serverRuntime.runPromise(
    requireVaultwarden().pipe(Effect.option)
  );
  const items = await readVaultItems(scope);
  const itemsByKind = Object.groupBy(items, (item) => item.kind);
  const otherItems = items.filter(
    (item) =>
      item.kind === "identity" || item.kind === "phone" || item.kind === "token"
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-3">
        <h1 className="type-page-title">{t("Seu cofre.")}</h1>
        <p className="type-supporting-body text-muted-foreground">
          {t("Você escolhe quais itens o Zoen pode usar e por quanto tempo.")}
        </p>
      </header>
      {Option.isSome(hosted) ? (
        <section className="flex items-center justify-between gap-4 rounded-3xl border bg-white/5 p-5">
          <div className="flex items-center gap-3">
            <LockKeyholeIcon className="size-6" />
            <div>
              <h2 className="type-label">{t("Seu cofre privado")}</h2>
              <p className="type-caption text-muted-foreground">
                {t("Protegido pela sua senha mestra.")}
              </p>
            </div>
          </div>
          <Button
            nativeButton={false}
            render={
              <a
                aria-label={t("Abrir cofre")}
                href={hosted.value.url}
                target="_blank"
                rel="noreferrer"
              />
            }
            variant="outline"
          >
            {t("Abrir cofre")}
            <ArrowUpRightIcon />
          </Button>
        </section>
      ) : null}
      <h2 className="type-section-title">{t("Acessos deste espaço")}</h2>
      <VaultLogins items={itemsByKind.login ?? []} />
      <VaultCards items={itemsByKind.payment ?? []} />
      <VaultAddresses items={itemsByKind.address ?? []} />
      <VaultContacts items={itemsByKind.contact ?? []} />
      <VaultOtherItems items={otherItems} />
    </div>
  );
}

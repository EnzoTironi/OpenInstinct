"use client";

import { useI18n } from "@web/i18n/context";

import { PlusIcon } from "lucide-react";
import type { VaultItem } from "@shared/vault/schema";
import { Button } from "@web/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog";
import { AddressForm } from "./form";
import {
  useVaultSection,
  VaultItemBrowser,
  VaultSection,
  VaultSectionBackButton,
  VaultSectionContent,
  VaultSectionTrigger,
} from "../section";
import { useVaultSetup } from "../setup";

export function VaultAddresses({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  const { t, locale } = useI18n();
  const setup = useVaultSetup();
  const initialAdd = setup?.kind === "address";
  const section = useVaultSection(initialAdd ? "add" : "list");

  return (
    <VaultSection
      onOpenChange={section.onOpenChange}
      open={section.open}
      title={t("Addresses")}
    >
      <VaultSectionTrigger items={items} title={t("Addresses")} />
      <VaultSectionContent view={section.view}>
        {section.view === "list" ? (
          <>
            <DialogHeader className="pr-10 sm:pr-6">
              <DialogTitle>{t("Addresses")}</DialogTitle>
              <DialogDescription>
                {items.length > 0
                  ? t("Buscar e gerenciar itens salvos ({count}).", {
                      count: items.length.toLocaleString(locale),
                    })
                  : t("Add your first saved address.")}
              </DialogDescription>
            </DialogHeader>
            <VaultItemBrowser
              items={items}
              searchId="vault-search-addresses"
              title={t("Addresses")}
            />
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  section.setView("add");
                }}
                type="button"
              >
                <PlusIcon />
                {t("Add address")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <VaultSectionBackButton
              onClick={() => {
                section.setView("list");
              }}
              title={t("Addresses")}
            />
            <DialogHeader className="pr-10 sm:pr-6">
              <DialogTitle>{t("Add address")}</DialogTitle>
              <DialogDescription>
                {t(
                  "Sensitive values are encrypted before database storage and are never returned after saving."
                )}
              </DialogDescription>
            </DialogHeader>
            <AddressForm
              initialLabel={initialAdd ? setup.label : undefined}
              onSaved={() => {
                section.setView("list");
              }}
            />
          </>
        )}
      </VaultSectionContent>
    </VaultSection>
  );
}

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
import { ContactForm } from "./form";
import {
  useVaultSection,
  VaultItemBrowser,
  VaultSection,
  VaultSectionBackButton,
  VaultSectionContent,
  VaultSectionTrigger,
} from "../section";
import { useVaultSetup } from "../setup";

export function VaultContacts({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  const { t, locale } = useI18n();
  const setup = useVaultSetup();
  const initialAdd = setup?.kind === "contact";
  const section = useVaultSection(initialAdd ? "add" : "list");

  return (
    <VaultSection
      onOpenChange={section.onOpenChange}
      open={section.open}
      title={t("Contact info")}
    >
      <VaultSectionTrigger items={items} title={t("Contact info")} />
      <VaultSectionContent view={section.view}>
        {section.view === "list" ? (
          <>
            <DialogHeader className="pr-10 sm:pr-6">
              <DialogTitle>{t("Contact info")}</DialogTitle>
              <DialogDescription>
                {items.length > 0
                  ? t("Buscar e gerenciar itens salvos ({count}).", {
                      count: items.length.toLocaleString(locale),
                    })
                  : t("Add your first saved contact.")}
              </DialogDescription>
            </DialogHeader>
            <VaultItemBrowser
              items={items}
              searchId="vault-search-contacts"
              title={t("Contact info")}
            />
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  section.setView("add");
                }}
                type="button"
              >
                <PlusIcon />
                {t("Add contact")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <VaultSectionBackButton
              onClick={() => {
                section.setView("list");
              }}
              title={t("Contact info")}
            />
            <DialogHeader className="pr-10 sm:pr-6">
              <DialogTitle>{t("Add contact")}</DialogTitle>
              <DialogDescription>
                {t(
                  "Sensitive values are encrypted before database storage and are never returned after saving."
                )}
              </DialogDescription>
            </DialogHeader>
            <ContactForm
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

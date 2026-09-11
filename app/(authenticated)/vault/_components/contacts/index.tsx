"use client";

import type { VaultItem } from "@shared/vault/schema";
import { Button } from "@web/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  useVaultSection,
  VaultItemBrowser,
  VaultSection,
  VaultSectionBackButton,
  VaultSectionContent,
  VaultSectionTrigger,
} from "../section";
import { useVaultSetup } from "../setup";
import { ContactForm } from "./form";

type VaultView = "add" | "import" | "list";

function setVaultView(setView: (view: VaultView) => void, view: VaultView) {
  return () => {
    setView(view);
  };
}

function contactsDescription(count: number) {
  if (count > 0) {
    return `Search and manage ${count.toLocaleString()} saved contact info.`;
  }

  return "Add your first saved contact.";
}

function ContactsListView({
  items,
  onAdd,
}: {
  readonly items: readonly VaultItem[];
  readonly onAdd: () => void;
}) {
  return (
    <>
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>Contact info</DialogTitle>
        <DialogDescription>
          {contactsDescription(items.length)}
        </DialogDescription>
      </DialogHeader>
      <VaultItemBrowser
        items={items}
        searchId="vault-search-contacts"
        title="Contact info"
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onAdd} type="button">
          <PlusIcon />
          Add contact
        </Button>
      </div>
    </>
  );
}

function ContactsAddView({
  initialLabel,
  onBack,
  onSaved,
}: {
  readonly initialLabel?: string;
  readonly onBack: () => void;
  readonly onSaved: () => void;
}) {
  return (
    <>
      <VaultSectionBackButton onClick={onBack} title="Contact info" />
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>Add contact</DialogTitle>
        <DialogDescription>
          Sensitive values are encrypted before database storage and are never
          returned after saving.
        </DialogDescription>
      </DialogHeader>
      <ContactForm initialLabel={initialLabel} onSaved={onSaved} />
    </>
  );
}

function contactsPanel(
  view: VaultView,
  list: ReactNode,
  add: ReactNode
): ReactNode {
  if (view === "list") return list;

  return add;
}

function contactsInitialView(isContactSetup: boolean): VaultView {
  if (isContactSetup) return "add";

  return "list";
}

export function VaultContacts({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  const setup = useVaultSetup();
  const isContactSetup = setup?.kind === "contact";
  const section = useVaultSection(contactsInitialView(isContactSetup));
  const goList = setVaultView(section.setView, "list");

  return (
    <VaultSection
      onOpenChange={section.onOpenChange}
      open={section.open}
      title="Contact info"
    >
      <VaultSectionTrigger items={items} title="Contact info" />
      <VaultSectionContent view={section.view}>
        {contactsPanel(
          section.view,
          <ContactsListView
            items={items}
            onAdd={setVaultView(section.setView, "add")}
          />,
          <ContactsAddView
            initialLabel={isContactSetup ? setup.label : undefined}
            onBack={goList}
            onSaved={goList}
          />
        )}
      </VaultSectionContent>
    </VaultSection>
  );
}

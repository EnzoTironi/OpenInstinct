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
import { AddressForm } from "./form";

type VaultView = "add" | "import" | "list";

function setVaultView(setView: (view: VaultView) => void, view: VaultView) {
  return () => {
    setView(view);
  };
}

function addressesDescription(count: number) {
  if (count > 0) {
    return `Search and manage ${count.toLocaleString()} saved addresses.`;
  }

  return "Add your first saved address.";
}

function AddressesListView({
  items,
  onAdd,
}: {
  readonly items: readonly VaultItem[];
  readonly onAdd: () => void;
}) {
  return (
    <>
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>Addresses</DialogTitle>
        <DialogDescription>
          {addressesDescription(items.length)}
        </DialogDescription>
      </DialogHeader>
      <VaultItemBrowser
        items={items}
        searchId="vault-search-addresses"
        title="Addresses"
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onAdd} type="button">
          <PlusIcon />
          Add address
        </Button>
      </div>
    </>
  );
}

function AddressesAddView({
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
      <VaultSectionBackButton onClick={onBack} title="Addresses" />
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>Add address</DialogTitle>
        <DialogDescription>
          Sensitive values are encrypted before database storage and are never
          returned after saving.
        </DialogDescription>
      </DialogHeader>
      <AddressForm initialLabel={initialLabel} onSaved={onSaved} />
    </>
  );
}

function addressesPanel(
  view: VaultView,
  list: ReactNode,
  add: ReactNode
): ReactNode {
  if (view === "list") return list;

  return add;
}

function addressesInitialView(isAddressSetup: boolean): VaultView {
  if (isAddressSetup) return "add";

  return "list";
}

export function VaultAddresses({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  const setup = useVaultSetup();
  const isAddressSetup = setup?.kind === "address";
  const section = useVaultSection(addressesInitialView(isAddressSetup));
  const goList = setVaultView(section.setView, "list");

  return (
    <VaultSection
      onOpenChange={section.onOpenChange}
      open={section.open}
      title="Addresses"
    >
      <VaultSectionTrigger items={items} title="Addresses" />
      <VaultSectionContent view={section.view}>
        {addressesPanel(
          section.view,
          <AddressesListView
            items={items}
            onAdd={setVaultView(section.setView, "add")}
          />,
          <AddressesAddView
            initialLabel={isAddressSetup ? setup.label : undefined}
            onBack={goList}
            onSaved={goList}
          />
        )}
      </VaultSectionContent>
    </VaultSection>
  );
}

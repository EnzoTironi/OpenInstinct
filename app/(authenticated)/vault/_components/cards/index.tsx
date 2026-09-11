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
import { CardForm } from "./form";

type VaultView = "add" | "import" | "list";

function setVaultView(setView: (view: VaultView) => void, view: VaultView) {
  return () => {
    setView(view);
  };
}

function cardsDescription(count: number) {
  if (count > 0) {
    return `Search and manage ${count.toLocaleString()} saved cards.`;
  }

  return "Add your first saved card.";
}

function CardsListView({
  items,
  onAdd,
}: {
  readonly items: readonly VaultItem[];
  readonly onAdd: () => void;
}) {
  return (
    <>
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>Cards</DialogTitle>
        <DialogDescription>{cardsDescription(items.length)}</DialogDescription>
      </DialogHeader>
      <VaultItemBrowser
        items={items}
        searchId="vault-search-cards"
        title="Cards"
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onAdd} type="button">
          <PlusIcon />
          Add card
        </Button>
      </div>
    </>
  );
}

function CardsAddView({
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
      <VaultSectionBackButton onClick={onBack} title="Cards" />
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>Add card</DialogTitle>
        <DialogDescription>
          Sensitive values are encrypted before database storage and are never
          returned after saving.
        </DialogDescription>
      </DialogHeader>
      <CardForm initialLabel={initialLabel} onSaved={onSaved} />
    </>
  );
}

function cardsPanel(
  view: VaultView,
  list: ReactNode,
  add: ReactNode
): ReactNode {
  if (view === "list") return list;

  return add;
}

function cardsInitialView(isPaymentSetup: boolean): VaultView {
  if (isPaymentSetup) return "add";

  return "list";
}

export function VaultCards({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  const setup = useVaultSetup();
  const isPaymentSetup = setup?.kind === "payment";
  const section = useVaultSection(cardsInitialView(isPaymentSetup));
  const goList = setVaultView(section.setView, "list");

  return (
    <VaultSection
      onOpenChange={section.onOpenChange}
      open={section.open}
      title="Cards"
    >
      <VaultSectionTrigger items={items} title="Cards" />
      <VaultSectionContent view={section.view}>
        {cardsPanel(
          section.view,
          <CardsListView
            items={items}
            onAdd={setVaultView(section.setView, "add")}
          />,
          <CardsAddView
            initialLabel={isPaymentSetup ? setup.label : undefined}
            onBack={goList}
            onSaved={goList}
          />
        )}
      </VaultSectionContent>
    </VaultSection>
  );
}

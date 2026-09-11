"use client";

import type { VaultItem } from "@shared/vault/schema";
import { Button } from "@web/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog";
import { PlusIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
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
import { LoginForm } from "./form";
import { ChromeImportPanel } from "./import";

type VaultView = "add" | "import" | "list";

interface LoginSetup {
  readonly kind: "login";
  readonly label: string;
  readonly origin?: string;
  readonly identifierType?: "email" | "phone" | "username";
}

function setVaultView(setView: (view: VaultView) => void, view: VaultView) {
  return () => {
    setView(view);
  };
}

function loginsDescription(count: number) {
  if (count > 0) {
    return `Search and manage ${count.toLocaleString()} saved logins.`;
  }

  return "Add your first saved login.";
}

function addLoginTitle(setup: LoginSetup | undefined) {
  if (setup) return `Add ${setup.label}`;

  return "Add login";
}

function LoginsListView({
  items,
  onImport,
  onAdd,
}: {
  readonly items: readonly VaultItem[];
  readonly onImport: () => void;
  readonly onAdd: () => void;
}) {
  return (
    <>
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>Logins</DialogTitle>
        <DialogDescription>{loginsDescription(items.length)}</DialogDescription>
      </DialogHeader>
      <VaultItemBrowser
        items={items}
        searchId="vault-search-logins"
        title="Logins"
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onImport} type="button" variant="outline">
          Bulk import
        </Button>
        <Button onClick={onAdd} type="button">
          <PlusIcon />
          Add login
        </Button>
      </div>
    </>
  );
}

function LoginsImportView({
  onBack,
  onDone,
}: {
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  return (
    <>
      <VaultSectionBackButton onClick={onBack} title="Logins" />
      <ChromeImportPanel onDone={onDone} />
    </>
  );
}

function LoginsAddView({
  setup,
  onBack,
  onSaved,
}: {
  readonly setup: LoginSetup | undefined;
  readonly onBack: () => void;
  readonly onSaved: () => void;
}) {
  return (
    <>
      <VaultSectionBackButton onClick={onBack} title="Logins" />
      <DialogHeader className="pr-10 sm:pr-6">
        <DialogTitle>{addLoginTitle(setup)}</DialogTitle>
        <DialogDescription>
          Enter the credentials you use to sign in.
        </DialogDescription>
      </DialogHeader>
      <LoginForm
        initialIdentifierType={setup?.identifierType}
        initialLabel={setup?.label}
        initialOrigin={setup?.origin}
        onSaved={onSaved}
      />
    </>
  );
}

function loginsDetailView(
  view: VaultView,
  importView: ReactNode,
  addView: ReactNode
): ReactNode {
  if (view === "import") return importView;

  return addView;
}

function loginsPanel(
  view: VaultView,
  list: ReactNode,
  detail: ReactNode
): ReactNode {
  if (view === "list") return list;

  return detail;
}

function loginsInitialView(
  chromeImport: boolean,
  hasSetup: boolean
): VaultView {
  if (chromeImport) return "import";

  if (hasSetup) return "add";

  return "list";
}

export function VaultLogins({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  const searchParams = useSearchParams();
  const setup = useVaultSetup();
  const initialSetup = setup?.kind === "login" ? setup : undefined;
  const initialChromeImport = searchParams.get("import") === "chrome";

  const section = useVaultSection(
    loginsInitialView(initialChromeImport, Boolean(initialSetup))
  );

  const goList = setVaultView(section.setView, "list");

  return (
    <VaultSection
      onOpenChange={section.onOpenChange}
      open={section.open}
      title="Logins"
    >
      <VaultSectionTrigger items={items} title="Logins" />
      <VaultSectionContent view={section.view}>
        {loginsPanel(
          section.view,
          <LoginsListView
            items={items}
            onAdd={setVaultView(section.setView, "add")}
            onImport={setVaultView(section.setView, "import")}
          />,
          loginsDetailView(
            section.view,
            <LoginsImportView onBack={goList} onDone={goList} />,
            <LoginsAddView
              onBack={goList}
              onSaved={goList}
              setup={initialSetup}
            />
          )
        )}
      </VaultSectionContent>
    </VaultSection>
  );
}

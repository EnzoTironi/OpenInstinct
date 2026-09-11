"use client";

import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog";
import { Input } from "@web/components/ui/input";
import { Label } from "@web/components/ui/label";
import { api } from "@web/trpc/client";
import {
  ExternalLinkIcon,
  FileKeyIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useState } from "react";

import { parseChromePasswordsCsv } from "./parse-chrome-passwords";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const GOOGLE_PASSWORD_MANAGER_URL = "https://passwords.google.com/options";

type ChromeSelection = ReturnType<typeof parseChromePasswordsCsv>;

function resolveImportError(
  error: string | undefined,
  importFailed: boolean
): string | undefined {
  if (error) return error;

  if (importFailed) {
    return "The import did not finish. Check the vault error and try again.";
  }

  return undefined;
}

function pluralizeLogin(count: number) {
  if (count === 1) return "login";

  return "logins";
}

function pluralizeRow(count: number) {
  if (count === 1) return "row";

  return "rows";
}

function SelectionSummary({
  fileName,
  selection,
}: {
  readonly fileName: string;
  readonly selection: ChromeSelection;
}) {
  const skippedSuffix =
    selection.skipped > 0
      ? ` · ${selection.skipped.toLocaleString()} invalid ${pluralizeRow(selection.skipped)} skipped`
      : "";

  return (
    <p className="type-supporting-body text-muted-foreground">
      {selection.items.length.toLocaleString()}{" "}
      {pluralizeLogin(selection.items.length)} ready from {fileName}
      {skippedSuffix}
    </p>
  );
}

function ExportStep() {
  return (
    <div className="grid gap-2">
      <p className="type-label">1. Export your passwords</p>
      <p className="type-supporting-body text-muted-foreground">
        Open Settings in Google Password Manager and choose Export passwords.
      </p>
      <Button
        nativeButton={false}
        render={
          <a
            aria-label="Open Google Password Manager"
            href={GOOGLE_PASSWORD_MANAGER_URL}
            rel="noreferrer"
            target="_blank"
          />
        }
        variant="outline"
      >
        Open Google Password Manager
        <ExternalLinkIcon />
      </Button>
    </div>
  );
}

function ImportErrorAlert({ message }: { readonly message?: string }) {
  if (!message) return null;

  return (
    <Alert variant="destructive">
      <FileKeyIcon />
      <AlertTitle>Couldn&apos;t import this file</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function VaultSafetyAlert() {
  return (
    <Alert>
      <ShieldCheckIcon />
      <AlertTitle>Your passwords stay in your vault</AlertTitle>
      <AlertDescription>
        The CSV is read in this browser and is not copied to Kernel. Chrome
        exports passwords as plain text, so delete the file after this import.
      </AlertDescription>
    </Alert>
  );
}

function ImportSuccessAlert({ count }: { readonly count: number }) {
  return (
    <Alert>
      <ShieldCheckIcon />
      <AlertTitle>
        {count.toLocaleString()} {pluralizeLogin(count)} imported
      </AlertTitle>
      <AlertDescription>
        They are now available to the agent through the encrypted vault. Delete
        the exported CSV from your device.
      </AlertDescription>
    </Alert>
  );
}

function importButtonLabel(
  isPending: boolean,
  selection: ChromeSelection | undefined
) {
  if (isPending) return "Importing…";

  if (!selection) return "Choose a CSV";

  return `Import ${selection.items.length.toLocaleString()} ${pluralizeLogin(selection.items.length)}`;
}

function makeImportSuccess(
  count: number,
  router: { refresh: () => void },
  setSelection: (value: ChromeSelection | undefined) => void,
  setImportedCount: (value: number | undefined) => void,
  setFileName: (value: string) => void,
  bumpInputKey: () => void
) {
  return () => {
    router.refresh();
    setSelection(undefined);
    setImportedCount(count);
    setFileName("");
    bumpInputKey();
  };
}

function FileStep({
  disabled,
  fileName,
  inputKey,
  onFileChange,
  selection,
}: {
  readonly disabled: boolean;
  readonly fileName: string;
  readonly inputKey: number;
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly selection: ChromeSelection | undefined;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="chrome-passwords-csv">2. Choose the exported CSV</Label>
      <Input
        accept=".csv,text/csv"
        disabled={disabled}
        id="chrome-passwords-csv"
        key={inputKey}
        onChange={onFileChange}
        type="file"
      />
      {selection ? (
        <SelectionSummary fileName={fileName} selection={selection} />
      ) : null}
    </div>
  );
}

function ImportFormBody({
  disabled,
  fileName,
  importError,
  inputKey,
  onFileChange,
  selection,
}: {
  readonly disabled: boolean;
  readonly fileName: string;
  readonly importError: string | undefined;
  readonly inputKey: number;
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly selection: ChromeSelection | undefined;
}) {
  return (
    <div className="grid gap-5">
      <ExportStep />
      <FileStep
        disabled={disabled}
        fileName={fileName}
        inputKey={inputKey}
        onFileChange={onFileChange}
        selection={selection}
      />
      <ImportErrorAlert message={importError} />
      <VaultSafetyAlert />
    </div>
  );
}

function ImportFooterActions({
  importedCount,
  isPending,
  onDone,
  onImport,
  onReset,
  selection,
}: {
  readonly importedCount: number | undefined;
  readonly isPending: boolean;
  readonly onDone: () => void;
  readonly onImport: () => void;
  readonly onReset: () => void;
  readonly selection: ChromeSelection | undefined;
}) {
  if (importedCount !== undefined) {
    return (
      <Button
        onClick={() => {
          onReset();
          onDone();
        }}
        type="button"
      >
        Done
      </Button>
    );
  }

  return (
    <Button disabled={isPending || !selection} onClick={onImport} type="button">
      <UploadIcon />
      {importButtonLabel(isPending, selection)}
    </Button>
  );
}

async function readSelectedFile(
  file: File | undefined,
  setError: (value: string | undefined) => void,
  setSelection: (value: ChromeSelection | undefined) => void,
  setFileName: (value: string) => void
) {
  setError(undefined);
  setSelection(undefined);
  setFileName(file?.name ?? "");

  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    setError("Choose a CSV smaller than 10 MB.");

    return;
  }

  try {
    setSelection(parseChromePasswordsCsv(await file.text()));
  } catch (cause) {
    setError(
      cause instanceof Error ? cause.message : "That CSV could not be read."
    );
  }
}

export function ChromeImportPanel({ onDone }: { readonly onDone: () => void }) {
  const router = useRouter();
  const importPasswords = api.vault.import.useMutation();

  const [selection, setSelection] = useState<ChromeSelection>();
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string>();
  const [importedCount, setImportedCount] = useState<number>();
  const [inputKey, setInputKey] = useState(0);

  const bumpInputKey = () => {
    setInputKey((key) => key + 1);
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    importPasswords.reset();
    void readSelectedFile(
      event.currentTarget.files?.[0],
      setError,
      setSelection,
      setFileName
    );
  };

  const importSelectedPasswords = () => {
    if (!selection) return;
    setError(undefined);
    const count = selection.items.length;
    importPasswords.mutate(selection.items, {
      onSuccess: makeImportSuccess(
        count,
        router,
        setSelection,
        setImportedCount,
        setFileName,
        bumpInputKey
      ),
    });
  };

  const reset = () => {
    importPasswords.reset();
    setSelection(undefined);
    setFileName("");
    setError(undefined);
    setImportedCount(undefined);
    bumpInputKey();
  };

  const importError = resolveImportError(error, Boolean(importPasswords.error));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import Chrome passwords</DialogTitle>
        <DialogDescription>
          Export a CSV from Google Password Manager, then choose it here. The
          passwords go into this workspace&apos;s encrypted vault.
        </DialogDescription>
      </DialogHeader>

      {importedCount === undefined ? (
        <ImportFormBody
          disabled={importPasswords.isPending}
          fileName={fileName}
          importError={importError}
          inputKey={inputKey}
          onFileChange={chooseFile}
          selection={selection}
        />
      ) : (
        <ImportSuccessAlert count={importedCount} />
      )}

      <DialogFooter>
        <ImportFooterActions
          importedCount={importedCount}
          isPending={importPasswords.isPending}
          onDone={onDone}
          onImport={importSelectedPasswords}
          onReset={reset}
          selection={selection}
        />
      </DialogFooter>
    </>
  );
}

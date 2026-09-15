"use client";

import { Effect, Result } from "effect";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Checkbox } from "@web/components/ui/checkbox";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog";
import { Input } from "@web/components/ui/input";
import { Label } from "@web/components/ui/label";
import {
  parseLoginVaultPayload,
  type VaultImportItems,
} from "@shared/vault/schema";
import { api } from "@web/trpc/client";
import { parseChromePasswordsCsv } from "./chrome";

export function VaultImportPanel({ onDone }: { readonly onDone: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File>();
  const [selection, setSelection] = useState<{
    items: (VaultImportItems[number] & { importId: string })[];
    skipped: number;
  }>();
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [opening, start] = useTransition();
  const password = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    []
  );
  const importer = api.vault.import.useMutation({ gcTime: 0 });
  const encrypted = file?.name.toLowerCase().endsWith(".json");
  const busy = opening || importer.isPending;
  const read = () => {
    start(async () => {
      if (!file) return;
      setError(false);
      const controller = new AbortController();
      abort.current = controller;
      const result = await Effect.runPromise(
        Effect.tryPromise(async () => {
          if (file.size > 10 * 1024 * 1024) throw new Error("size");
          const source = await file.text();
          return encrypted
            ? await openInWorker(
                source,
                password.current?.value ?? "",
                controller.signal
              )
            : parseChromePasswordsCsv(source);
        }).pipe(Effect.result)
      );
      if (password.current) password.current.value = "";
      if (controller.signal.aborted) return;
      if (Result.isFailure(result)) {
        setError(true);
        return;
      }
      setSelection({
        ...result.success,
        items: result.success.items.map((item) => ({
          account: item.account,
          kind: item.kind,
          label: item.label,
          secret: item.secret,
          importId: crypto.randomUUID(),
        })),
      });
      setChosen(new Set());
    });
  };
  const save = () => {
    if (!selection || chosen.size === 0) return;
    importer.mutate(
      selection.items
        .filter((_, index) => chosen.has(index))
        .map(({ importId: _importId, ...item }) => item),
      {
        onSuccess: () => {
          importer.reset();
          setSelection(undefined);
          setFile(undefined);
          setChosen(new Set());
          setDone(true);
          router.refresh();
        },
      }
    );
  };
  return (
    <div className="grid gap-5" data-private>
      <DialogHeader>
        <DialogTitle>{t("Escolha o que compartilhar")}</DialogTitle>
        <DialogDescription>
          {t("Só os acessos selecionados serão copiados para este espaço.")}
        </DialogDescription>
      </DialogHeader>
      {done ? (
        <div className="grid gap-3">
          <ShieldCheckIcon />
          <p>
            {t(
              "Acessos adicionados. Agora escolha quais o Zoen pode usar e por quanto tempo."
            )}
          </p>
        </div>
      ) : selection ? (
        <>
          <div className="max-h-[40dvh] overflow-y-auto rounded-2xl border">
            {selection.items.map((item, index) => {
              const login = parseLoginVaultPayload(item.secret);
              return (
                <Label
                  key={item.importId}
                  className="flex cursor-pointer items-center gap-3 border-b p-4 last:border-0"
                >
                  <Checkbox
                    checked={chosen.has(index)}
                    onCheckedChange={(checked) => {
                      setChosen((current) => {
                        const next = new Set(current);
                        if (checked) next.add(index);
                        else next.delete(index);
                        return next;
                      });
                    }}
                    disabled={busy}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    <span className="block truncate type-caption text-muted-foreground">
                      {login && "origin" in login ? login.origin : ""}
                    </span>
                    <span className="block truncate type-caption text-muted-foreground">
                      {login?.identifier.value}
                    </span>
                  </span>
                </Label>
              );
            })}
          </div>
          {selection.skipped > 0 ? (
            <p className="type-caption text-muted-foreground">
              {t(
                "Itens não compatíveis: {count}. Use acessos com um único site HTTPS.",
                { count: selection.skipped }
              )}
            </p>
          ) : null}
          {selection.items.length === 0 ? (
            <p>{t("Nenhum acesso compatível neste arquivo.")}</p>
          ) : null}
        </>
      ) : (
        <>
          <details className="type-supporting-body text-muted-foreground">
            <summary>{t("Como preparar o arquivo")}</summary>
            <p className="mt-2">
              {t(
                "No Vaultwarden ou Bitwarden, exporte JSON criptografado com senha. Escolha uma senha para a exportação, diferente da senha mestra. Também aceitamos o CSV do Google Password Manager."
              )}
            </p>
          </details>
          <div className="grid gap-2">
            <Label htmlFor="vault-import-file">{t("Arquivo do cofre")}</Label>
            <Input
              id="vault-import-file"
              type="file"
              accept=".json,.csv,application/json,text/csv"
              disabled={busy}
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0]);
                setError(false);
                importer.reset();
              }}
            />
          </div>
          {encrypted ? (
            <div className="grid gap-2">
              <Label htmlFor="vault-export-password">
                {t("Senha da exportação")}
              </Label>
              <Input
                id="vault-export-password"
                ref={password}
                type="password"
                autoComplete="new-password"
                disabled={busy}
                maxLength={2_048}
              />
              <p className="type-caption text-muted-foreground">
                {t(
                  "O arquivo é aberto neste navegador. Esta senha não é enviada ao Zoen."
                )}
              </p>
            </div>
          ) : (
            <p className="type-caption text-muted-foreground">
              {t(
                "O CSV contém senhas em texto. Apague o arquivo após a importação."
              )}
            </p>
          )}
        </>
      )}
      {error || importer.error ? (
        <p role="alert" className="type-caption text-destructive">
          {t(
            "Não foi possível abrir ou importar. Confira o arquivo, a senha da exportação e o limite de 10 MB."
          )}
        </p>
      ) : null}
      <DialogFooter>
        {done ? (
          <Button onClick={onDone}>{t("Done")}</Button>
        ) : selection ? (
          <>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setSelection(undefined);
                setChosen(new Set());
              }}
            >
              {t("Voltar")}
            </Button>
            <Button disabled={busy || chosen.size === 0} onClick={save}>
              {t("Adicionar selecionados ({count})", { count: chosen.size })}
            </Button>
          </>
        ) : (
          <Button disabled={busy || !file} onClick={read}>
            {opening ? t("Abrindo…") : t("Escolher acessos")}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

async function openInWorker(
  source: string,
  password: string,
  signal: AbortSignal
) {
  return await new Promise<{ items: VaultImportItems; skipped: number }>(
    (resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("cancelled"));
        return;
      }
      const worker = new Worker(
        new URL("./bitwarden.worker.ts", import.meta.url),
        { type: "module" }
      );
      const cleanup = () => {
        clearTimeout(timer);
        worker.terminate();
        signal.removeEventListener("abort", stop);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("timeout"));
      }, 20_000);
      const stop = () => {
        cleanup();
        reject(new Error("cancelled"));
      };
      signal.addEventListener("abort", stop, { once: true });
      worker.addEventListener(
        "message",
        (
          event: MessageEvent<{
            items: VaultImportItems;
            skipped: number;
          } | null>
        ) => {
          cleanup();
          if (event.data) resolve(event.data);
          else reject(new Error("export"));
        },
        { once: true }
      );
      worker.addEventListener(
        "error",
        () => {
          cleanup();
          reject(new Error("worker"));
        },
        { once: true }
      );
      worker.postMessage({ source, password }, []);
    }
  );
}

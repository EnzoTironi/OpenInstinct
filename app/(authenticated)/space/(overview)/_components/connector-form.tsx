"use client";

import { useRef, useState } from "react";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Textarea } from "@web/components/ui/textarea";

export function ConnectorForm({
  onConnected,
  onClose,
}: {
  readonly onConnected: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [credential, setCredential] = useState("");
  const [kind, setKind] = useState<"mcp" | "openapi">("mcp");
  const [share, setShare] = useState<"owner" | "workspace">("owner");
  const [document, setDocument] = useState("");
  const id = useRef(crypto.randomUUID());
  const connect = api.workspaces.tools.connections.connect.useMutation();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void connect
          .mutateAsync({
            id: id.current,
            name,
            endpoint,
            credential,
            kind,
            share,
            document: kind === "openapi" ? document : undefined,
          })
          .then(async () => {
            setCredential("");
            await onConnected();
            return undefined;
          })
          .catch(() => undefined);
      }}
    >
      <h3 className="type-title">{t("Conectar serviço")}</h3>
      <Input
        aria-label={t("Nome")}
        placeholder={t("Nome")}
        value={name}
        maxLength={80}
        required
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <Input
        aria-label={t("Endereço HTTPS")}
        placeholder="https://"
        type="url"
        value={endpoint}
        maxLength={1000}
        required
        onChange={(e) => {
          setEndpoint(e.target.value);
        }}
      />
      <fieldset className="flex gap-2" aria-label={t("Tipo de conexão")}>
        {(["mcp", "openapi"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={kind === value ? "default" : "outline"}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
            }}
          >
            {value === "mcp" ? "MCP" : "OpenAPI"}
          </Button>
        ))}
      </fieldset>
      <Input
        aria-label={t("Chave de acesso opcional")}
        placeholder={t("Chave de acesso opcional")}
        type="password"
        autoComplete="off"
        data-private
        value={credential}
        maxLength={8000}
        onChange={(e) => {
          setCredential(e.target.value);
        }}
      />
      {kind === "openapi" && (
        <Textarea
          aria-label={t("Documento OpenAPI em JSON")}
          placeholder={t("Documento OpenAPI em JSON")}
          value={document}
          maxLength={262144}
          required
          onChange={(e) => {
            setDocument(e.target.value);
          }}
        />
      )}
      <fieldset className="grid gap-2">
        <legend className="mb-2 type-caption">{t("Quem pode usar?")}</legend>
        <label className="type-body flex gap-2">
          <input
            type="radio"
            name="sharing"
            checked={share === "owner"}
            onChange={() => {
              setShare("owner");
            }}
          />
          {t("Só eu")}
        </label>
        <label className="type-body flex gap-2">
          <input
            type="radio"
            name="sharing"
            checked={share === "workspace"}
            onChange={() => {
              setShare("workspace");
            }}
          />
          {t("Membros e grupos deste espaço")}
        </label>
      </fieldset>
      <p className="type-caption text-muted-foreground">
        {t("As ações deste serviço sempre pedem aprovação.")}
      </p>
      {connect.error && (
        <p role="alert">
          {t(
            "Não foi possível conectar. Confira o endereço, a chave e os formatos aceitos."
          )}
        </p>
      )}
      <Button type="submit" disabled={connect.isPending}>
        {connect.isPending ? t("Conectando…") : t("Conectar")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={connect.isPending}
        onClick={onClose}
      >
        {t("Voltar")}
      </Button>
    </form>
  );
}

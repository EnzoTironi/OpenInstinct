"use client";

import { useI18n } from "@web/i18n/context";
import type { EveAuthorizationPart } from "eve/react";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";

export function AuthorizationPrompt({
  part,
}: {
  readonly part: EveAuthorizationPart;
}) {
  const { t } = useI18n();
  const isAuthorized =
    part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized
    ? CheckCircleIcon
    : isCompleted
      ? XCircleIcon
      : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions =
    instructions !== undefined && instructions !== part.description;
  const alertVariant = isAuthorized
    ? "success"
    : isCompleted
      ? "destructive"
      : "information";

  return (
    <Alert variant={alertVariant}>
      <Icon />
      <AlertTitle>{authorizationTitle(part, t)}</AlertTitle>
      <AlertDescription>
        <p>{authorizationDescription(part, t)}</p>
        {shouldShowInstructions ? <p>{instructions}</p> : null}
        {part.state === "required" && part.authorization?.userCode ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{t("Code")}</span>
            <Badge variant="outline">
              <code className="type-compact-code">
                {part.authorization.userCode}
              </code>
            </Badge>
          </div>
        ) : null}
        {part.state === "required" && part.authorization?.url ? (
          <Button
            render={
              <a
                aria-label={t("Entrar com {name}", { name: part.displayName })}
                href={part.authorization.url}
                rel="noreferrer"
                target="_blank"
              />
            }
            size="sm"
          >
            <ExternalLinkIcon />
            {t("Sign in with")} {part.displayName}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function authorizationTitle(
  part: EveAuthorizationPart,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (part.state === "required")
    return t("Conectar {name}", { name: part.displayName });
  if (part.outcome === "authorized")
    return t("{name} conectado.", { name: part.displayName });
  return t("Autorização de {name}: {status}.", {
    name: part.displayName,
    status: t(formatAuthorizationOutcome(part.outcome)),
  });
}

function authorizationDescription(
  part: EveAuthorizationPart,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (part.state === "required") return part.description;
  if (part.outcome === "authorized")
    return t("{name} conectado.", { name: part.displayName });
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${authorizationTitle(part, t)}${tail}`;
}

function formatAuthorizationOutcome(
  outcome: NonNullable<EveAuthorizationPart["outcome"]>
): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
  throw new Error("Unsupported authorization outcome.");
}
